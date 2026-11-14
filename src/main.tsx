import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import Dashboard from "../app/dashboard";
import "../app/globals.css";
import "./pages.css";
import { basePath } from "./config";

function PagesApp() {
  const [query, setQuery] = useState(window.location.search);
  useEffect(() => {
    const update = () => setQuery(window.location.search);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  function navigate(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest("a") : null;
    if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
    const url = new URL(target.href);
    if (url.protocol !== location.protocol || url.host !== location.host || url.pathname !== basePath) return;
    event.preventDefault();
    history.pushState(null, "", url.pathname + url.search);
    setQuery(url.search);
    window.scrollTo(0, 0);
  }
  const params = new URLSearchParams(query);
  const corp = params.get("corp") ?? "";
  return <div onClickCapture={navigate}><Dashboard corpCode={/^\d{8}$/.test(corp) ? corp : undefined}
    view={params.get("view") ?? undefined} giants={params.get("section") === "giants"} settings={params.get("section") === "settings"}/></div>;
}

createRoot(document.getElementById("root")!).render(<PagesApp/>);
