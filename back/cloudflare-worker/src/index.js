const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!origin || allowed.includes("*") || allowed.includes(origin)) return origin || "*";
  return null;
}

function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type,Authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(request, env))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const origin = allowedOrigin(request, env);
    if (request.headers.get("Origin") && !origin) {
      return new Response(JSON.stringify({ error: "Origine non autorisée." }), {
        status: 403,
        headers: { ...JSON_HEADERS },
      });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Route introuvable." }), {
        status: 404,
        headers: { ...JSON_HEADERS, ...cors },
      });
    }

    if (!env.UPSTREAM_API_URL) {
      return new Response(JSON.stringify({ error: "UPSTREAM_API_URL n'est pas configurée." }), {
        status: 500,
        headers: { ...JSON_HEADERS, ...cors },
      });
    }

    const upstream = new URL(url.pathname + url.search, env.UPSTREAM_API_URL);
    const headers = new Headers(request.headers);
    headers.delete("host");
    try {
      const response = await fetch(upstream, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });
      return withCors(response, request, env);
    } catch {
      return new Response(JSON.stringify({ error: "Backend amont indisponible." }), {
        status: 502,
        headers: { ...JSON_HEADERS, ...cors },
      });
    }
  },
};
