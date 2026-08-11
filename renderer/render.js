import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { chromium } from "playwright";

const execFileAsync =
    promisify(execFile);


export async function renderVideo(
    job
) {

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


    try {

        await fs.writeFile(
            htmlPath,
            job.html,
            "utf8"
        );


        job.status =
            "rendering";

        job.progress =
            20;

        job.message =
            "Starting Chromium...";


        /*
         * Start Chromium.
         */

        const browser =
            await chromium.launch({

                headless: true,

                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage"
                  //  "--disable-gpu"
                ]

            });


        const context =
            await browser.newContext({

                viewport: {
                    width: job.width,
                    height: job.height
                },

                deviceScaleFactor: 1,

                recordVideo: {
                    dir: temp,
                    size: {
                        width: job.width,
                        height: job.height
                    }
                }

            });


        const page =
            await context.newPage();


        /*
         * Make browser look like a
         * normal modern browser.
         */

        await page.setViewportSize({

            width: job.width,
            height: job.height

        });


        job.progress =
            30;

        job.message =
            "Loading HTML...";


        /*
         * Load supplied HTML.
         */

        await page.goto(
            "file://" +
            htmlPath,
            {
                waitUntil:
                    "load",
                timeout:
                    15000
            }
        );


        /*
         * Wait for fonts/images.
         */

        await page.evaluate(
            async () => {

                if (
                    document.fonts &&
                    document.fonts.ready
                ) {

                    await document.fonts.ready;

                }


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


        /*
         * Give animations time to
         * initialize.
         */

        await page.waitForTimeout(
            300
        );


        job.progress =
            40;

        job.message =
            "Recording animation...";


        /*
         * Keep the browser alive
         * for the requested duration.
         */

        const started =
            Date.now();

        const total =
            job.duration * 1000;


        while (
            Date.now() - started <
            total
        ) {

            const elapsed =
                Date.now() -
                started;


            const progress =
                40 +
                (
                    elapsed /
                    total
                ) * 40;


            job.progress =
                Math.min(
                    80,
                    Math.round(progress)
                );


            job.message =
                "Recording " +
                Math.round(
                    elapsed / 1000
                ) +
                " / " +
                job.duration +
                " seconds";


            await page.waitForTimeout(
                250
            );

        }


        /*
         * Closing context finalizes
         * the Playwright video.
         */

        await context.close();

        await browser.close();


        /*
         * Find recorded WebM.
         */

        const files =
            await fs.readdir(temp);


        const videoFile =
            files.find(
                file =>
                    file.endsWith(".webm")
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
            "Encoding MP4 with FFmpeg...";


        /*
         * FFmpeg:
         *
         * WebM → H.264 MP4
         */

        await execFileAsync(
            "ffmpeg",
            [

                "-y",

                "-i",
                webmPath,

                "-c:v",
                "libx264",

                "-preset",
                "ultrafast",

                "-crf",
                "23",

                "-pix_fmt",
                "yuv420p",

            //    "-r",
           //     String(job.fps),

                "-movflags",
                "+faststart",

                outputPath

            ],
            {
                timeout:
                    120000,
                maxBuffer:
                    1024 * 1024 * 10
            }
        );


        job.progress =
            100;

        job.status =
            "completed";

        job.message =
            "MP4 ready";


        return outputPath;

    }

    catch (error) {

        job.status =
            "failed";

        job.error =
            error.message;

        throw error;

    }

}

