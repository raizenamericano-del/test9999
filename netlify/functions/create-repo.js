import { Octokit } from "@octokit/rest";

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

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
    const { token, name, isPrivate, description } = JSON.parse(event.body || "{}");
    if (!token) return { statusCode: 400, headers, body: JSON.stringify({ error: "Token wajib diisi" }) };
    if (!name || !NAME_RE.test(name))
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Nama repo tidak valid. Gunakan huruf, angka, tanda hubung (-), underscore (_), atau titik (.)" }),
      };

    const octokit = new Octokit({ auth: token.trim() });

    const { data: repo } = await octokit.repos.createForAuthenticatedUser({
      name,
      private: !!isPrivate,
      description: description || "Dibuat otomatis oleh Zip2Repo 🚀",
      auto_init: true, // penting: init dengan commit awal agar Git Data API langsung siap (hindari 409 repo kosong)
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        full_name: repo.full_name,
        html_url: repo.html_url,
        owner: repo.owner.login,
        name: repo.name,
        private: repo.private,
        default_branch: repo.default_branch || "main",
      }),
    };
  } catch (err) {
    const status = err.status || 500;
    let msg = "Gagal membuat repository.";
    if (status === 401) msg = "Token tidak valid. Silakan perbarui token di Settings.";
    else if (status === 422) msg = "Nama repository sudah ada di akun kamu. Gunakan nama lain.";
    else if (status === 403) {
      const m = (err.message || "").toLowerCase();
      msg = m.includes("rate limit")
        ? "Rate limit GitHub tercapai. Tunggu beberapa menit lalu coba lagi."
        : "Akses ditolak. Pastikan token memiliki permission 'repo'.";
    }
    return { statusCode: status, headers, body: JSON.stringify({ error: msg }) };
  }
};
