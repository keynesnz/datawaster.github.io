/*
=========================================================
HTML → MP4
CLOUDFLARE WORKER
=========================================================
*/


const ALLOWED_ORIGINS = [
    "https://keynesnz.github.io"
];


/*
=========================================================
CORS
=========================================================
*/

function corsHeaders(
    origin
) {

    const allowed =
        ALLOWED_ORIGINS.includes(
            origin
        );


    return {

        "Access-Control-Allow-Origin":
            allowed
                ? origin
                : ALLOWED_ORIGINS[0],

        "Access-Control-Allow-Methods":
            "GET,POST,OPTIONS",

        "Access-Control-Allow-Headers":
            "Content-Type",

        "Access-Control-Max-Age":
            "86400"

    };

}


/*
=========================================================
JSON RESPONSE
=========================================================
*/

function json(
    data,
    status,
    origin
) {

    return new Response(

        JSON.stringify(
            data
        ),

        {

            status,

            headers: {

                "Content-Type":
                    "application/json",

                ...corsHeaders(
                    origin
                )

            }

        }

    );

}


/*
=========================================================
AUTH
=========================================================
*/

function rendererHeaders(
    env
) {

    return {

        "Content-Type":
            "application/json",

        "X-Render-API-Key":
            env.RENDER_API_KEY

    };

}


/*
=========================================================
MAIN
=========================================================
*/

export default {

    async fetch(
        request,
        env
    ) {

        const url =
            new URL(
                request.url
            );


        const origin =
            request.headers.get(
                "Origin"
            ) || "";


        /*
        -----------------------------------------------
        CORS preflight
        -----------------------------------------------
        */

        if (
            request.method ===
            "OPTIONS"
        ) {

            return new Response(
                null,
                {
                    status:
                        204,

                    headers:
                        corsHeaders(
                            origin
                        )
                }
            );

        }


        /*
        -----------------------------------------------
        Check origin
        -----------------------------------------------
        */

        if (
            !ALLOWED_ORIGINS.includes(
                origin
            )
        ) {

            return json(

                {
                    error:
                        "Origin not allowed."
                },

                403,

                origin

            );

        }


        /*
        -----------------------------------------------
        Renderer URL
        -----------------------------------------------
        */

        const renderer =
            env.RENDERER_URL;


        if (!renderer) {

            return json(

                {
                    error:
                        "Renderer is not configured."
                },

                500,

                origin

            );

        }


        /*
        =================================================
        CREATE JOB
        =================================================
        */

        if (
            request.method ===
            "POST" &&
            url.pathname ===
            "/jobs"
        ) {

            const body =
                await request.text();


            /*
            Limit request body.
            */

            if (
                body.length >
                3_000_000
            ) {

                return json(

                    {
                        error:
                            "Request is too large."
                    },

                    413,

                    origin

                );

            }


            const response =
                await fetch(

                    renderer +
                    "/jobs",

                    {

                        method:
                            "POST",

                        headers:
                            rendererHeaders(
                                env
                            ),

                        body

                    }

                );


            return new Response(

                response.body,

                {

                    status:
                        response.status,

                    headers: {

                        "Content-Type":
                            "application/json",

                        ...corsHeaders(
                            origin
                        )

                    }

                }

            );

        }


        /*
        =================================================
        JOB STATUS
        =================================================
        */

        const statusMatch =
            url.pathname.match(
                /^\/jobs\/([^/]+)$/
            );


        if (
            request.method ===
            "GET" &&
            statusMatch
        ) {

            const jobId =
                statusMatch[1];


            const response =
                await fetch(

                    renderer +
                    "/jobs/" +
                    encodeURIComponent(
                        jobId
                    ),

                    {

                        method:
                            "GET",

                        headers:
                            {

                                "X-Render-API-Key":
                                    env.RENDER_API_KEY

                            }

                    }

                );


            return new Response(

                response.body,

                {

                    status:
                        response.status,

                    headers: {

                        "Content-Type":
                            "application/json",

                        ...corsHeaders(
                            origin
                        )

                    }

                }

            );

        }


        /*
        =================================================
        DOWNLOAD
        =================================================
        */

        const downloadMatch =
            url.pathname.match(
                /^\/jobs\/([^/]+)\/download$/
            );


        if (
            request.method ===
            "GET" &&
            downloadMatch
        ) {

            const jobId =
                downloadMatch[1];


            const response =
                await fetch(

                    renderer +
                    "/jobs/" +
                    encodeURIComponent(
                        jobId
                    ) +
                    "/download",

                    {

                        method:
                            "GET",

                        headers:
                            {

                                "X-Render-API-Key":
                                    env.RENDER_API_KEY

                            }

                    }

                );


            const headers =
                new Headers(
                    response.headers
                );


            headers.set(
                "Access-Control-Allow-Origin",
                origin
            );


            headers.set(
                "Content-Disposition",
                'attachment; filename="render.mp4"'
            );


            return new Response(

                response.body,

                {

                    status:
                        response.status,

                    headers

                }

            );

        }


        /*
        =================================================
        NOT FOUND
        =================================================
        */

        return json(

            {
                error:
                    "Not found."
            },

            404,

            origin

        );

    }

};

