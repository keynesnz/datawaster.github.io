import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { chromium } from "playwright";

const execFileAsync = promisify(execFile);

/*
=========================================================
LOW-RAM SETTINGS
=========================================================
*/

/*
 * Render Chromium at 50% of the requested resolution.
 *
 * Example:
 *
 * 1080x1920 -> 540x960
 * 1920x1080 -> 960x540
 *
 * FFmpeg then scales the result back to the requested
 * output resolution.
 *
 * This is important for a 512 MB Render instance.
 */
const RENDER_SCALE = 0.5;

/*
 * Do not allow extremely large jobs to overwhelm
 * the small instance.
 */
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1920;

/*
 * Give Chromium enough time to load external fonts.
 */
const PAGE_LOAD_TIMEOUT = 20000;

/*
 * Small startup delay so CSS/JS animations can initialize.
 */
const INITIAL_DELAY = 500;

/*
 * FFmpeg timeout.
 */
const FFMPEG_TIMEOUT = 120000;


/*
=========================================================
HELPERS
=========================================================
*/

function scaledDimension(value) {
    return Math.max(
        1,
        Math.round(value * RENDER_SCALE)
    );
}


/*
=========================================================
MAIN RENDER FUNCTION
=========================================================
*/

export async function renderVideo(job) {

    const id =
        crypto.randomUUID();

    const temp =
        await fs.mkdtemp(
            path.join(
                os.tmpdir(),
                "html-mp4-"
            )
        );

    const htmlPath =
        path.join(
            temp,
            "index.html"
        );

    const outputPath =
        path.join(
            temp,
            "output.mp4"
        );


    /*
    -------------------------------------------------------
    Validate dimensions
    -------------------------------------------------------
    */

    if (
        !Number.isFinite(job.width) ||
        !Number.isFinite(job.height) ||
        job.width < 1 ||
        job.height < 1 ||
        job.width > MAX_WIDTH ||
        job.height > MAX_HEIGHT
    ) {
        throw new Error(
            "Invalid render dimensions."
        );
    }


    /*
    -------------------------------------------------------
    Calculate low-resolution browser viewport
    -------------------------------------------------------
    */

    const renderWidth =
        scaledDimension(
            job.width
        );

    const renderHeight =
        scaledDimension(
            job.height
        );


    try {

        /*
        =====================================================
        WRITE HTML
        =====================================================
        */

        await fs.writeFile(
            htmlPath,
            job.html,
            "utf8"
        );


        job.status =
            "rendering";

        job.progress =
            5;

        job.message =
            "Starting low-memory Chromium...";


        /*
        =====================================================
        START CHROMIUM
        =====================================================
        */

        const browser =
            await chromium.launch({

                headless: true,

                /*
                 * These flags are deliberately conservative
                 * for a 512 MB container.
                 */
                args: [

                    "--no-sandbox",

                    "--disable-setuid-sandbox",

                    "--disable-dev-shm-usage",

                    /*
                     * Prevent background browser work.
                     */
                    "--disable-background-networking",

                    "--disable-background-timer-throttling",

                    "--disable-backgrounding-occluded-windows",

                    "--disable-breakpad",

                    "--disable-component-update",

                    "--disable-default-apps",

                    "--disable-extensions",

                    "--disable-features=Translate,BackForwardCache",

                    "--disable-hang-monitor",

                    "--disable-ipc-flooding-protection",

                    "--disable-notifications",

                    "--disable-popup-blocking",

                    "--disable-prompt-on-repost",

                    "--disable-renderer-backgrounding",

                    "--disable-sync",

                    "--no-first-run",

                    "--no-default-browser-check",

                    /*
                     * Keep memory pressure down.
                     */
                    "--renderer-process-limit=1",

                    "--disable-gpu"

                ]

            });


        /*
        =====================================================
        BROWSER CONTEXT
        =====================================================
        */

        const context =
            await browser.newContext({

                viewport: {
                    width:
                        renderWidth,

                    height:
                        renderHeight
                },

                /*
                 * Important:
                 * do NOT multiply pixels again.
                 */
                deviceScaleFactor: 1,

                /*
                 * Record at the reduced resolution.
                 */
                recordVideo: {

                    dir:
                        temp,

                    size: {

                        width:
                            renderWidth,

                        height:
                            renderHeight
                    }
                },

                /*
                 * Avoid unnecessary browser state.
                 */
                serviceWorkers:
                    "block",

                colorScheme:
                    "dark"

            });


        const page =
            await context.newPage();


        /*
        =====================================================
        LOAD HTML
        =====================================================
        */

        job.progress =
            15;

        job.message =
            "Loading HTML...";


        await page.goto(
            "file://" +
            htmlPath,
            {
                waitUntil:
                    "load",

                timeout:
                    PAGE_LOAD_TIMEOUT
            }
        );


        /*
        =====================================================
        WAIT FOR FONTS
        =====================================================
        */

        job.progress =
            25;

        job.message =
            "Waiting for fonts...";


        try {

            await page.evaluate(
                async () => {

                    if (
                        document.fonts &&
                        document.fonts.ready
                    ) {

                        await document.fonts.ready;

                    }

                }
            );

        } catch {
            /*
             * Font loading failure should not kill
             * the entire render.
             */
        }


        /*
        =====================================================
        WAIT FOR IMAGES
        =====================================================
        */

        try {

            await page.evaluate(
                async () => {

                    const images =
                        Array.from(
                            document.images
                        );

                    await Promise.all(
                        images.map(
                            img => {

                                if (
                                    img.complete
                                ) {
                                    return Promise.resolve();
                                }

                                return new Promise(
                                    resolve => {

                                        img.addEventListener(
                                            "load",
                                            resolve,
                                            {
                                                once: true
                                            }
                                        );

                                        img.addEventListener(
                                            "error",
                                            resolve,
                                            {
                                                once: true
                                            }
                                        );

                                    }
                                );

                            }
                        )
                    );

                }
            );

        } catch {
            /*
             * Continue even if an image fails.
             */
        }


        /*
        =====================================================
        FORCE STABLE LAYOUT
        =====================================================
        */

        await page.evaluate(
            () => {

                /*
                 * Disable caret blinking.
                 */
                const style =
                    document.createElement(
                        "style"
                    );

                style.textContent = `
                    * {
                        caret-color: transparent !important;
                    }

                    html {
                        overflow: hidden !important;
                    }

                    body {
                        overflow: hidden !important;
                    }
                `;

                document.head.appendChild(
                    style
                );

            }
        );


        /*
        =====================================================
        INITIALIZATION DELAY
        =====================================================
        */

        await page.waitForTimeout(
            INITIAL_DELAY
        );


        job.progress =
            35;

        job.message =
            "Recording animation...";


        /*
        =====================================================
        RECORD VIDEO
        =====================================================
        */

        const started =
            Date.now();

        const total =
            Number(job.duration) *
            1000;


        while (
            Date.now() -
            started <
            total
        ) {

            const elapsed =
                Date.now() -
                started;


            const progress =
                35 +
                (
                    elapsed /
                    total
                ) * 45;


            job.progress =
                Math.min(
                    80,
                    Math.round(
                        progress
                    )
                );


            job.message =
                "Recording " +
                Math.min(
                    job.duration,
                    Math.floor(
                        elapsed / 1000
                    )
                ) +
                " / " +
                job.duration +
                " seconds";


            /*
             * Do not poll every 250ms.
             *
             * 500ms reduces JS wakeups and CPU
             * overhead on the tiny instance.
             */
            await page.waitForTimeout(
                500
            );

        }


        /*
        =====================================================
        CLOSE PAGE/CONTEXT
        =====================================================
        */

        /*
         * Closing the context finalizes the WebM.
         */
        await context.close();

        /*
         * Browser can now be completely released
         * before FFmpeg starts.
         */
        await browser.close();


        /*
        =====================================================
        FIND WEBM
        =====================================================
        */

        const files =
            await fs.readdir(
                temp
            );


        const videoFile =
            files.find(
                file =>
                    file.endsWith(
                        ".webm"
                    )
            );


        if (!videoFile) {

            throw new Error(
                "Chromium did not produce a video."
            );

        }


        const webmPath =
            path.join(
                temp,
                videoFile
            );


        job.progress =
            82;

        job.message =
            "Encoding MP4...";


        /*
        =====================================================
        FFMPEG
        =====================================================

        Input:
            540x960 WebM

        Output:
            1080x1920 MP4

        or

            960x540 -> 1920x1080

        depending on the requested resolution.
        =====================================================
        */

        await execFileAsync(
            "ffmpeg",
            [

                "-y",

                /*
                 * Input.
                 */
                "-i",
                webmPath,


                /*
                 * Constant frame rate.
                 *
                 * This is important for smooth playback.
                 */
                "-fps_mode",
                "cfr",

                "-r",
                String(job.fps),


                /*
                 * Scale back to requested output size.
                 *
                 * Lanczos gives better quality when
                 * upscaling the reduced browser render.
                 */
                "-vf",
                `scale=${job.width}:${job.height}:flags=lanczos`,


                /*
                 * H.264.
                 */
                "-c:v",
                "libx264",


                /*
                 * Very fast encoding.
                 *
                 * The browser is the expensive part;
                 * don't make FFmpeg unnecessarily slow.
                 */
                "-preset",
                "veryfast",


                /*
                 * Good quality while keeping file size
                 * reasonable.
                 */
                "-crf",
                "20",


                /*
                 * Maximum compatibility.
                 */
                "-pix_fmt",
                "yuv420p",


                /*
                 * Fast MP4 start.
                 */
                "-movflags",
                "+faststart",


                /*
                 * Output.
                 */
                outputPath

            ],
            {

                timeout:
                    FFMPEG_TIMEOUT,

                maxBuffer:
                    5 * 1024 * 1024

            }
        );


        /*
        =====================================================
        VERIFY OUTPUT
        =====================================================
        */

        const stat =
            await fs.stat(
                outputPath
            );


        if (
            !stat.size ||
            stat.size < 1000
        ) {

            throw new Error(
                "FFmpeg produced an invalid MP4."
            );

        }


        /*
        =====================================================
        CLEAN WEBM
        =====================================================
        */

        /*
         * Free disk space immediately.
         */
        try {

            await fs.rm(
                webmPath,
                {
                    force: true
                }
            );

        } catch {
            /*
             * Ignore cleanup failure.
             */
        }


        /*
        =====================================================
        COMPLETE
        =====================================================
        */

        job.progress =
            100;

        job.status =
            "completed";

        job.message =
            "MP4 ready";


        return outputPath;


    } catch (error) {

        /*
        =====================================================
        ERROR
        =====================================================
        */

        job.status =
            "failed";

        job.error =
            error?.message ||
            String(error);


        throw error;

    }

}

