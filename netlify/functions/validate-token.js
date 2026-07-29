import { Octokit } from "@octokit/rest";

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { token } = JSON.parse(event.body || "{}");
    if (!token || typeof token !== "string")
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Token wajib diisi" }) };

    const octokit = new Octokit({ auth: token.trim() });
    const { data: user } = await octokit.users.getAuthenticated();

    // Cek scope 'repo'
    let scopes = [];
    try {
      const res = await octokit.request("GET /user");
      scopes = (res.headers["x-oauth-scopes"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } catch (_) {}

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        valid: true,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
        html_url: user.html_url,
        public_repos: user.public_repos,
        total_private_repos: user.total_private_repos ?? null,
        scopes,
        has_repo_scope: scopes.includes("repo") || scopes.length === 0, // fine-grained token tidak expose scope
      }),
    };
  } catch (err) {
    const status = err.status || 500;
    let msg = "Gagal memvalidasi token.";
    if (status === 401) msg = "Token tidak valid atau sudah kedaluwarsa.";
    else if (status === 403) msg = "Akses ditolak / rate limit GitHub tercapai. Coba lagi nanti.";
    return { statusCode: status === 401 ? 401 : 500, headers, body: JSON.stringify({ error: msg }) };
  }
};
