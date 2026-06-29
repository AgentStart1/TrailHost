import { useState, useEffect } from "preact/hooks";
import {
  getBaseUrl,
  setBaseUrl,
  getTokens,
  saveTokens,
  login,
  register,
} from "../api/client";

type Step = "loading" | "setup" | "auth";
type AuthMode = "login" | "register";

export function App() {
  const [step, setStep] = useState<Step>("loading");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { accessToken } = await getTokens();
      if (accessToken) {
        window.close();
        return;
      }
      const base = await getBaseUrl();
      if (base) {
        setServerUrl(base);
        setStep("auth");
      } else {
        setStep("setup");
      }
    })();
  }, []);

  async function handleSetup(e: Event) {
    e.preventDefault();
    if (!serverUrl.startsWith("http")) {
      setError("URL 必须以 http:// 或 https:// 开头");
      return;
    }
    await setBaseUrl(serverUrl);
    setError("");
    setStep("auth");
  }

  async function handleAuth(e: Event) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const fn = authMode === "login" ? login : register;
      const result = await fn(email, password);
      await saveTokens(result.access_token, result.refresh_token);
      chrome.runtime.sendMessage({ type: "auth_changed", loggedIn: true });
      window.close();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "未知错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "loading") {
    return (
      <div class="page">
        <div class="card center">
          <span class="spinner" />
        </div>
      </div>
    );
  }

  if (step === "setup") {
    return (
      <div class="page">
        <div class="card">
          <div class="logo">
            <span class="logo-icon">⬡</span>
            <span class="logo-text">TrailHost</span>
          </div>
          <h1>连接到服务器</h1>
          <p class="subtitle">输入你部署的 TrailHost 后端地址</p>
          <form onSubmit={handleSetup}>
            <div class="field">
              <label>服务器地址</label>
              <input
                type="url"
                placeholder="https://your-domain.com"
                value={serverUrl}
                onInput={(e) =>
                  setServerUrl((e.target as HTMLInputElement).value)
                }
                required
                autofocus
              />
            </div>
            {error && <p class="error">{error}</p>}
            <button type="submit" class="btn-primary">继续</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div class="page">
      <div class="card">
        <div class="logo">
          <span class="logo-icon">⬡</span>
          <span class="logo-text">TrailHost</span>
        </div>

        <div class="tabs">
          <button
            class={authMode === "login" ? "tab active" : "tab"}
            onClick={() => { setAuthMode("login"); setError(""); }}
          >
            登录
          </button>
          <button
            class={authMode === "register" ? "tab active" : "tab"}
            onClick={() => { setAuthMode("register"); setError(""); }}
          >
            注册
          </button>
        </div>

        <form onSubmit={handleAuth}>
          <div class="field">
            <label>邮箱</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              required
              autofocus
            />
          </div>
          <div class="field">
            <label>密码</label>
            <input
              type="password"
              placeholder={authMode === "register" ? "至少 8 位" : ""}
              value={password}
              onInput={(e) =>
                setPassword((e.target as HTMLInputElement).value)
              }
              required
              minLength={authMode === "register" ? 8 : undefined}
            />
          </div>
          {error && <p class="error">{error}</p>}
          <button type="submit" class="btn-primary" disabled={submitting}>
            {submitting
              ? "请稍候…"
              : authMode === "login"
              ? "登录"
              : "创建账号"}
          </button>
        </form>

        <p class="change-server" onClick={() => { setStep("setup"); setError(""); }}>
          更换服务器
        </p>
      </div>
    </div>
  );
}
