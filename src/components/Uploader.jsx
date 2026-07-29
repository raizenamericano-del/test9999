import { useRef, useState } from "react";
import Stepper from "./Stepper.jsx";
import Confetti from "./Confetti.jsx";
import TerminalLog from "./TerminalLog.jsx";
import TiltCard from "./TiltCard.jsx";
import { extractZip, pushFiles, apiCreateRepo } from "../lib/github.js";
import { getToken, clearToken } from "../lib/storage.js";

const MAX_SIZE = 50 * 1024 * 1024; // 50MB

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function now() {
  return new Date().toLocaleTimeString("id-ID", { hour12: false });
}

export default function Uploader({ user, showToast, onTokenInvalid }) {
  const [repoName, setRepoName] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState("");

  // Proses
  const [phase, setPhase] = useState("idle"); // idle | working | success | error
  const [step, setStep] = useState(0);
  const [failedStep, setFailedStep] = useState(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [logs, setLogs] = useState([]);
  const [showRocket, setShowRocket] = useState(false);

  const inputRef = useRef(null);
  const logThrottle = useRef(0);

  function log(text, type = "info") {
    setLogs((ls) => [...ls.slice(-200), { time: now(), text, type }]);
  }

  function logFile(path, prefix) {
    // throttle log per-file agar tidak flooding
    const t = Date.now();
    if (t - logThrottle.current > 90) {
      logThrottle.current = t;
      log(`${prefix} ${path}`, "dim");
    }
  }

  function pickFile(f) {
    setFileError("");
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return setFileError("Hanya file .zip yang didukung.");
    if (f.size > MAX_SIZE) return setFileError(`Ukuran file ${fmtSize(f.size)} melebihi batas 50MB.`);
    if (f.size === 0) return setFileError("File kosong (0 byte).");
    setFile(f);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  }

  const repoNameValid = /^[A-Za-z0-9_.-]{1,100}$/.test(repoName);
  const canSubmit = repoNameValid && file && phase !== "working";

  async function start(e) {
    e.preventDefault();
    if (!canSubmit) return;
    const token = getToken();
    if (!token) return onTokenInvalid();

    setPhase("working");
    setFailedStep(null);
    setResult(null);
    setErrorMsg("");
    setLogs([]);
    setShowRocket(false);

    log("$ zip2repo deploy --branch main", "sys");
    log(`▶ target  : ${user.login}/${repoName} (${visibility})`);
    log(`▶ archive : ${file.name} (${fmtSize(file.size)})`);

    try {
      // STEP 1: Ekstrak
      setStep(0);
      setStatusText("Mengekstrak file ZIP di browser...");
      setProgress(0);
      log("── STEP 1/3 · EXTRACT ─────────────────", "sys");
      const files = await extractZip(file, (p, path) => {
        setProgress(p);
        logFile(path, "  unzip →");
      });
      log(`✔ ${files.length} file berhasil diekstrak`, "ok");

      // STEP 2: Buat repo
      setStep(1);
      setProgress(0);
      setStatusText(`Membuat repository "${repoName}" (${visibility})...`);
      log("── STEP 2/3 · CREATE REPO ─────────────", "sys");
      log(`  POST github.com/user/repos ...`);
      const repo = await apiCreateRepo({
        token,
        name: repoName,
        isPrivate: visibility === "private",
        description: `Diupload via Zip2Repo dari ${file.name}`,
      });
      log(`✔ repository dibuat: ${repo.full_name}`, "ok");

      // STEP 3: Push
      setStep(2);
      setProgress(0);
      setStatusText("Push file ke branch main...");
      log("── STEP 3/3 · PUSH ────────────────────", "sys");
      const pushRes = await pushFiles({
        token,
        owner: repo.owner,
        repo: repo.name,
        branch: repo.default_branch || "main",
        files,
        onProgress: (p, path) => {
          setProgress(p);
          logFile(path, "  push  ↑");
        },
        onStatus: (s) => { setStatusText(s); log(`  ${s}`, "warn"); },
      });
      log(`✔ commit ${pushRes.commitSha.slice(0, 7)} → refs/heads/main`, "ok");
      log("🎉 BUILD SUCCESS — repository siap!", "ok");

      // STEP 4: Selesai → roket meluncur dulu
      setStep(4);
      setStatusText("Selesai!");
      setShowRocket(true);
      setTimeout(() => {
        setResult({ ...repo, fileCount: pushRes.fileCount, commitSha: pushRes.commitSha });
        setPhase("success");
        showToast({ type: "success", message: "Repository berhasil dibuat & file ter-push! 🎉" });
      }, 1600);
    } catch (err) {
      setFailedStep(step);
      setErrorMsg(err.message || "Terjadi kesalahan tak terduga.");
      log(`✘ ERROR: ${err.message}`, "err");
      log("✘ BUILD FAILED", "err");
      setPhase("error");
      if (err.status === 401) {
        clearToken();
        showToast({ type: "error", message: "Token tidak valid — silakan masukkan ulang." });
        setTimeout(onTokenInvalid, 1200);
      }
    }
  }

  function reset() {
    setPhase("idle");
    setStep(0);
    setFailedStep(null);
    setProgress(0);
    setFile(null);
    setRepoName("");
    setStatusText("");
    setErrorMsg("");
    setResult(null);
    setLogs([]);
    setShowRocket(false);
  }

  /* ================== SUCCESS VIEW ================== */
  if (phase === "success" && result) {
    const vercelUrl = `https://vercel.com/new/clone?repository-url=${encodeURIComponent(result.html_url)}`;
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Confetti />
        <TiltCard max={6}>
          <div className="glass p-8 md:p-10 text-center animate-pop-in relative overflow-hidden">
            {/* Rocket image */}
            <img
              src="/rocket.png"
              alt="Roket sukses"
              className="mx-auto w-32 md:w-40 animate-levitate drop-shadow-[0_0_40px_rgba(34,211,238,0.5)]"
              draggable={false}
            />
            <h2 className="mt-4 text-3xl font-extrabold text-white">Meluncur! 🎉</h2>
            <p className="mt-2 text-slate-400">
              <b className="text-white">{result.fileCount}</b> file ter-push ke branch{" "}
              <code className="font-mono text-cyan-300">main</code>
            </p>

            <div className="mt-6 rounded-xl border border-white/10 bg-night-800/70 p-4 text-left">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Repository</p>
              <a
                href={result.html_url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-cyan-300 hover:text-cyan-200 hover:underline break-all"
              >
                {result.html_url}
              </a>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-2.5 py-1 border ${result.private ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"}`}>
                  {result.private ? "🔒 Private" : "🌍 Public"}
                </span>
                <span className="rounded-full px-2.5 py-1 border border-white/10 bg-white/5 text-slate-400 font-mono">
                  commit {result.commitSha.slice(0, 7)}
                </span>
              </div>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <a href={result.html_url} target="_blank" rel="noreferrer" className="btn-primary flex-1">
                <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
                Buka Repository
              </a>
              <a
                href={vercelUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost flex-1 !border-white/20 hover:!bg-white hover:!text-black"
                title="Deploy repository ini ke Vercel"
              >
                <svg viewBox="0 0 76 65" width="16" height="16" fill="currentColor"><path d="M37.59.25l36.95 64H.64l36.95-64z" /></svg>
                Deploy to Vercel
              </a>
            </div>

            <button onClick={reset} className="mt-6 text-sm text-slate-400 hover:text-white transition underline underline-offset-4">
              ⬅ Upload ZIP lain
            </button>
          </div>
        </TiltCard>
      </div>
    );
  }

  /* ================== WORKING / ERROR VIEW ================== */
  if (phase === "working" || phase === "error") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        {/* Rocket launch overlay */}
        {showRocket && (
          <div className="pointer-events-none fixed inset-0 z-[95] flex justify-center overflow-hidden">
            <img src="/rocket.png" alt="" className="w-40 md:w-52 animate-rocket-launch drop-shadow-[0_0_60px_rgba(34,211,238,0.7)]" />
          </div>
        )}

        <div className={phase === "working" ? "neon-card animate-fade-up" : "animate-fade-up"}>
        <div className="glass p-6 md:p-10 !rounded-2xl">
          <Stepper current={step} failedStep={failedStep} />

          {phase === "working" ? (
            <div className="mt-8">
              <div className="flex items-center justify-center gap-4">
                {/* Orbit loader mini */}
                <div className="relative h-14 w-14 shrink-0">
                  <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-400 border-r-cyan-400 animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center text-xl">
                    {step === 0 ? "🗜️" : step === 1 ? "📦" : step >= 2 ? "🚀" : "⚙️"}
                  </div>
                </div>
                <div className="text-left min-w-0">
                  <p className="font-semibold text-white">{statusText}</p>
                  <p className="text-xs text-slate-500 font-mono">{step === 1 ? "menghubungi GitHub..." : `${progress}%`}</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-5 h-2.5 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="stripe-bar h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-300"
                  style={{ width: `${step === 1 ? 100 : progress}%` }}
                />
              </div>

              {/* Terminal */}
              <div className="mt-6">
                <TerminalLog lines={logs} working />
              </div>
            </div>
          ) : (
            <div className="mt-8 text-center animate-pop-in">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-500/15 border-2 border-rose-400/50 text-4xl animate-wiggle">
                💥
              </div>
              <h3 className="mt-5 text-xl font-bold text-white">Ups, proses gagal</h3>
              <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {errorMsg}
              </p>
              <div className="mt-5">
                <TerminalLog lines={logs} working={false} />
              </div>
              <div className="mt-6 flex gap-3 justify-center">
                <button onClick={() => setPhase("idle")} className="btn-primary">🔁 Coba Lagi</button>
                <button onClick={reset} className="btn-ghost">Mulai Ulang</button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    );
  }

  /* ================== FORM VIEW ================== */
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 md:py-14">
      <div className="text-center animate-fade-up relative">
        <img
          src="/mascot.png"
          alt="Maskot"
          className="mx-auto w-24 md:w-28 animate-float drop-shadow-[0_0_30px_rgba(99,102,241,0.5)]"
          draggable={false}
        />
        <h1 className="mt-3 text-3xl md:text-4xl font-extrabold text-white">
          Upload ZIP → <span className="gradient-text">GitHub Repo</span> ⚡
        </h1>
        <p className="mt-3 text-slate-400">
          Halo, <b className="text-white">@{user?.login}</b>! Isi nama repo, pilih visibilitas, lalu lempar ZIP kamu.
        </p>
      </div>

      <TiltCard max={4}>
        <form onSubmit={start} className="glass mt-8 p-6 md:p-8 space-y-6 animate-fade-up [animation-delay:.15s]">
          {/* Nama repo */}
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">📛 Nama Repository</label>
            <div className="flex items-center gap-0 rounded-xl bg-night-800/80 border border-white/10 focus-within:border-indigo-400/70 focus-within:ring-2 focus-within:ring-indigo-500/25 transition-all overflow-hidden">
              <span className="pl-4 pr-1 py-3 font-mono text-sm text-slate-500 select-none whitespace-nowrap">
                {user?.login}/
              </span>
              <input
                value={repoName}
                onChange={(e) => setRepoName(e.target.value.replace(/\s+/g, "-"))}
                placeholder="proyek-keren-saya"
                className="flex-1 bg-transparent py-3 pr-4 font-mono text-slate-100 placeholder-slate-600 outline-none min-w-0"
                spellCheck={false}
              />
            </div>
            {repoName && !repoNameValid && (
              <p className="mt-2 text-xs text-amber-300 animate-pop-in">
                ⚠️ Gunakan huruf, angka, <code>-</code>, <code>_</code>, atau <code>.</code> (maks. 100 karakter)
              </p>
            )}
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">👁️ Visibilitas</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { v: "public", icon: "🌍", title: "Public", desc: "Semua orang bisa melihat" },
                { v: "private", icon: "🔒", title: "Private", desc: "Hanya kamu yang bisa akses" },
              ].map((opt) => (
                <button
                  type="button"
                  key={opt.v}
                  onClick={() => setVisibility(opt.v)}
                  className={`rounded-xl border p-4 text-left transition-all duration-200 active:scale-[0.97] ${
                    visibility === opt.v
                      ? "border-indigo-400/70 bg-indigo-500/15 shadow-[0_0_18px_rgba(99,102,241,0.3)]"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"
                  }`}
                >
                  <span className="text-xl">{opt.icon}</span>
                  <p className="mt-1 font-semibold text-white">{opt.title}</p>
                  <p className="text-xs text-slate-400">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Dropzone */}
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">🗂️ File ZIP <span className="text-slate-500 font-normal">(maks. 50MB)</span></label>
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 ${
                dragOver
                  ? "border-cyan-400 bg-cyan-400/10 scale-[1.02] shadow-[0_0_30px_rgba(34,211,238,0.25)]"
                  : file
                  ? "border-emerald-400/50 bg-emerald-400/[0.06]"
                  : "border-white/15 bg-white/[0.02] hover:border-indigo-400/50 hover:bg-indigo-400/[0.05]"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              {file ? (
                <div className="animate-pop-in">
                  <span className="text-4xl">📦</span>
                  <p className="mt-2 font-semibold text-white break-all">{file.name}</p>
                  <p className="text-sm text-emerald-300">{fmtSize(file.size)} ✓</p>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="mt-2 text-xs text-slate-400 hover:text-rose-300 underline underline-offset-2"
                  >
                    Hapus file
                  </button>
                </div>
              ) : (
                <div>
                  <span className={`inline-block text-4xl ${dragOver ? "animate-wiggle" : "animate-float"}`}>🗜️</span>
                  <p className="mt-2 font-medium text-slate-300">
                    {dragOver ? "Lepaskan di sini!" : "Drag & drop ZIP ke sini"}
                  </p>
                  <p className="text-sm text-slate-500">atau klik untuk memilih file</p>
                </div>
              )}
            </div>
            {fileError && (
              <p className="mt-2 text-sm text-rose-300 animate-pop-in">⚠️ {fileError}</p>
            )}
          </div>

          <button type="submit" disabled={!canSubmit} className="btn-primary w-full text-base !py-4">
            🚀 Buat Repository & Push
          </button>
        </form>
      </TiltCard>

      <p className="mt-6 text-center text-xs text-slate-600 animate-fade-up [animation-delay:.3s]">
        ZIP diekstrak langsung di browser • README.md dibuat otomatis jika tidak ada • Push ke branch <code className="font-mono">main</code>
      </p>
    </div>
  );
}
