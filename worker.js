const CHUNK_SIZE = 1024 * 1024; // 1 MiB
const CHUNKS_PER_REQUEST = 32;  // 32 MiB per request

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Content-Type": "application/octet-stream",
  "Content-Encoding": "identity"
};

function createStream() {
  return new ReadableStream({
    pull(controller) {
      if (this.sent >= CHUNKS_PER_REQUEST) {
        controller.close();
        return;
      }

      const chunk = new Uint8Array(CHUNK_SIZE);
      crypto.getRandomValues(chunk);

      controller.enqueue(chunk);
      this.sent++;
    },

    start() {
      this.sent = 0;
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (url.pathname !== "/data") {
      return new Response("OK");
    }

    return new Response(createStream(), {
      headers: {
        ...headers,
        "Content-Length": String(
          CHUNK_SIZE * CHUNKS_PER_REQUEST
        )
      }
    });
  }
};
