import "./styles.css";
import { LayerCard } from "@nocoo/basalt";
import { createRoot } from "react-dom/client";
import { version } from "../../../package.json";
import logoSrc from "../../../packages/web/public/logo-24.png";
import { AppView, type Page } from "./views/AppView.js";

const mounted = new WeakMap<HTMLElement, () => void>();

export function mountDashboard(element: HTMLElement): () => void {
  if (element?.nodeType !== 1)
    throw new Error("A dashboard root element is required");
  const existing = mounted.get(element);
  if (existing) return existing;
  const root = createRoot(element);
  let page: Page = "overview";
  let disposed = false;
  function render() {
    root.render(
      <AppView
        version={version}
        logoSrc={logoSrc}
        page={page}
        mode="local"
        squads={[]}
        selectedSquadId={null}
        busy={false}
        error={null}
        canCreateSquad={false}
        canChangeMode={false}
        onPageChange={(next) => {
          if (!disposed) {
            page = next;
            render();
          }
        }}
        onModeChange={() => undefined}
        onSquadChange={() => undefined}
        onCreateSquad={() => undefined}
      >
        <LayerCard.Empty
          title="工程初始化"
          description="应用壳已就绪。工作区、定义编辑与运行服务尚未连接；当前不加载样例数据，也不启动对话。"
        />
      </AppView>,
    );
  }
  render();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.unmount();
    mounted.delete(element);
  };
  mounted.set(element, dispose);
  return dispose;
}

if (typeof document !== "undefined") {
  const element = document.getElementById("root");
  if (element) mountDashboard(element);
}
