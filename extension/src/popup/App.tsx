import { useState, useEffect } from "preact/hooks";
import { getTokens, clearTokens } from "../api/client";

type View = "loading" | "loggedout" | "loggedin";

function openAuthPage() {
  chrome.tabs.create({
    url: chrome.runtime.getURL("src/auth-page/index.html"),
  });
  window.close();
}

export function App() {
  const [view, setView] = useState<View>("loading");

  useEffect(() => {
    (async () => {
      const { accessToken } = await getTokens();
      setView(accessToken ? "loggedin" : "loggedout");
    })();

    // Re-check when this popup regains focus (e.g. after auth tab closes)
    const onFocus = async () => {
      const { accessToken } = await getTokens();
      setView(accessToken ? "loggedin" : "loggedout");
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  async function handleLogout() {
    await clearTokens();
    chrome.runtime.sendMessage({ type: "auth_changed", loggedIn: false });
    setView("loggedout");
  }

  if (view === "loading") {
    return <div class="center"><span class="spinner" /></div>;
  }

  if (view === "loggedout") {
    return (
      <div class="container">
        <h1>TrailHost</h1>
        <p class="status">同步你的浏览历史记录</p>
        <button onClick={openAuthPage}>登录 / 注册</button>
      </div>
    );
  }

  return (
    <div class="container">
      <h1>TrailHost</h1>
      <p class="status">正在同步历史记录</p>
      <button
        onClick={() =>
          chrome.tabs.create({
            url: chrome.runtime.getURL("src/history-page/index.html"),
          })
        }
      >
        查看历史
      </button>
      <button class="secondary" onClick={handleLogout}>退出登录</button>
    </div>
  );
}
