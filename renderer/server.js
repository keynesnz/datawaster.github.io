import express from "express";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import { renderVideo } from "./render.js";


const app = express();

const PORT =
    process.env.PORT || 10000;

const API_KEY =
    process.env.API_KEY || "";


/*
=========================================================
SETTINGS
=========================================================
*/

const MAX_HTML_SIZE =
    2 * 1024 * 1024; // 2 MB

const MAX_DURATION =
    30;

const MAX_CONCURRENT_JOBS =
    1;


/*
=========================================================
MIDDLEWARE
=========================================================
*/

app.use(
    express.json({
        limit: "3mb"
    })
);


/*
=========================================================
JOB STORAGE
=========================================================
*/

const jobs =
    new Map();


let activeJobs = 0;


/*
=========================================================
AUTHENTICATION
=========================================================
*/

function checkAPIKey(req, res, next) {

    /*
     * During local testing, an empty
     * API_KEY allows access.
     */

    if (!API_KEY) {

        return next();

    }


    const received =
        req.headers[
            "x-render-api-key"
        ];


    if (
        !received ||
        received !== API_KEY
    ) {

        return res
            .status(401)
            .json({
                error:
                    "Unauthorized"
            });

    }


    next();

}


/*
=========================================================
HEALTH CHECK
=========================================================
*/

app.get(
    "/",
    (req, res) => {

        res.json({

            service:
                "HTML to MP4 Renderer",

            status:
                "online"

        });

    }
);


/*
=========================================================
CREATE JOB
=========================================================
*/

app.post(
    "/jobs",
    checkAPIKey,
    async (req, res) => {

        try {

            const {
                html,
                width,
                height,
                fps,
                duration
            } = req.body;


            /*
            ---------------------------------------------
            Validate HTML
            ---------------------------------------------
            */

            if (
                typeof html !==
                "string"
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "HTML is required."
                    });

            }


            if (
                Buffer.byteLength(
                    html,
                    "utf8"
                ) >
                MAX_HTML_SIZE
            ) {

                return res
                    .status(413)
                    .json({
                        error:
                            "HTML file is too large. Maximum is 2 MB."
                    });

            }


            /*
            ---------------------------------------------
            Validate resolution
            ---------------------------------------------
            */

            const w =
                Number(width);

            const h =
                Number(height);


            const allowedResolutions = [

                [720, 1280],

                [1080, 1920],

                [1080, 1080],

                [1920, 1080]

            ];


            const validResolution =
                allowedResolutions.some(
                    ([rw, rh]) =>
                        rw === w &&
                        rh === h
                );


            if (
                !validResolution
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Unsupported resolution."
                    });

            }


            /*
            ---------------------------------------------
            Validate FPS
            ---------------------------------------------
            */

            const frameRate =
                Number(fps);


            if (
                ![24, 30, 60]
                    .includes(
                        frameRate
                    )
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "FPS must be 24, 30 or 60."
                    });

            }


            /*
            ---------------------------------------------
            Validate duration
            ---------------------------------------------
            */

            const seconds =
                Number(duration);


            if (
                !Number.isFinite(
                    seconds
                ) ||
                seconds < 1 ||
                seconds > MAX_DURATION
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Duration must be between 1 and 30 seconds."
                    });

            }


            /*
            ---------------------------------------------
            Create job
            ---------------------------------------------
            */

            const id =
                crypto.randomUUID();


            const job = {

                id,

                html,

                width: w,

                height: h,

                fps: frameRate,

                duration: seconds,

                status:
                    "queued",

                progress:
                    0,

                message:
                    "Waiting for renderer...",

                createdAt:
                    Date.now(),

                outputPath:
                    null,

                error:
                    null

            };


            jobs.set(
                id,
                job
            );


            /*
            ---------------------------------------------
            Start asynchronously
            ---------------------------------------------
            */

            processQueue();


            return res
                .status(202)
                .json({

                    id,

                    status:
                        job.status

                });

        }

        catch (error) {

            console.error(
                error
            );

            return res
                .status(500)
                .json({
                    error:
                        "Failed to create job."
                });

        }

    }
);


/*
=========================================================
JOB STATUS
=========================================================
*/

app.get(
    "/jobs/:id",
    checkAPIKey,
    (req, res) => {

        const job =
            jobs.get(
                req.params.id
            );


        if (!job) {

            return res
                .status(404)
                .json({
                    error:
                        "Job not found."
                });

        }


        res.json({

            id:
                job.id,

            status:
                job.status,

            progress:
                job.progress,

            message:
                job.message,

            error:
                job.error

        });

    }
);


/*
=========================================================
DOWNLOAD MP4
=========================================================
*/

app.get(
    "/jobs/:id/download",
    checkAPIKey,
    async (req, res) => {

        const job =
            jobs.get(
                req.params.id
            );


        if (!job) {

            return res
                .status(404)
                .send(
                    "Job not found."
                );

        }


        if (
            job.status !==
            "completed"
        ) {

            return res
                .status(409)
                .send(
                    "Video is not ready."
                );

        }


        if (
            !job.outputPath
        ) {

            return res
                .status(404)
                .send(
                    "Output file not found."
                );

        }


        try {

            await fs.promises.access(
                job.outputPath
            );

        }

        catch {

            return res
                .status(404)
                .send(
                    "Output file no longer exists."
                );

        }


        res.download(
            job.outputPath,
            "FA_Community_Shield.mp4"
        );

    }
);


/*
=========================================================
PROCESS QUEUE
=========================================================
*/

function processQueue() {

    if (
        activeJobs >=
        MAX_CONCURRENT_JOBS
    ) {

        return;

    }


    const nextJob =
        Array.from(
            jobs.values()
        )
        .find(
            job =>
                job.status ===
                "queued"
        );


    if (!nextJob) {

        return;

    }


    runJob(
        nextJob
    );

}


/*
=========================================================
RUN JOB
=========================================================
*/

async function runJob(
    job
) {

    activeJobs++;


    try {

        job.status =
            "rendering";

        job.progress =
            1;

        job.message =
            "Starting renderer...";


        const outputPath =
            await renderVideo(
                job
            );


        job.outputPath =
            outputPath;

        job.status =
            "completed";

        job.progress =
            100;

        job.message =
            "MP4 ready";


    }

    catch (error) {

        console.error(
            "Render error:",
            error
        );


        job.status =
            "failed";

        job.progress =
            0;

        job.error =
            error.message;

    }

    finally {

        activeJobs--;

        processQueue();

    }

}


/*
=========================================================
CLEAN OLD JOBS
=========================================================
*/

setInterval(
    async () => {

        const now =
            Date.now();


        for (
            const [id, job]
            of jobs
        ) {

            /*
             * Delete jobs older
             * than 30 minutes.
             */

            if (
                now -
                job.createdAt >
                30 * 60 * 1000
            ) {

                try {

                    if (
                        job.outputPath
                    ) {

                        await fs.promises.rm(
                            job.outputPath,
                            {
                                force:
                                    true
                            }
                        );

                    }

                }

                catch (error) {

                    console.error(
                        "Cleanup error:",
                        error
                    );

                }


                jobs.delete(
                    id
                );

            }

        }

    },

    5 * 60 * 1000

);


/*
=========================================================
START SERVER
=========================================================
*/

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Renderer listening on port ${PORT}`
        );

    }
);

