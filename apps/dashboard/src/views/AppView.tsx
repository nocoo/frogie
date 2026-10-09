import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  ContentIsland,
  DialogDescription,
  DialogTitle,
  Field,
  LinkProvider,
  SegmentControl,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarProvider,
  SidebarUser,
  Text,
  ThemeProvider,
  ThemeToggle,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nocoo/basalt";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import {
  AppMain,
  AppShell,
  AppSkipLink,
} from "@nocoo/basalt/components/app-shell";
import { Banner } from "@nocoo/basalt/components/banner";
import { LinkButton } from "@nocoo/basalt/components/button";
import { Combobox } from "@nocoo/basalt/components/combobox";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import {
  BookOpen,
  createLucideIcon,
  FlaskConical,
  GitBranch,
  Hexagon,
  LayoutDashboard,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

export type Page = "overview" | "definitions" | "workflows" | "chat" | "evals";
export type Mode = "local" | "e2e";

export interface AppViewProps {
  version: string;
  logoSrc: string;
  page: Page;
  mode: Mode;
  squads: readonly { id: string; title: string }[];
  selectedSquadId: string | null;
  busy: boolean;
  error: string | null;
  canCreateSquad?: boolean;
  canChangeMode?: boolean;
  onPageChange(page: Page): void;
  onModeChange(mode: Mode): void;
  onSquadChange(id: string): void;
  onCreateSquad(): void;
  children?: ReactNode;
}

const pages = [
  { id: "overview", title: "概览", icon: LayoutDashboard },
  { id: "definitions", title: "定义", icon: BookOpen },
  { id: "workflows", title: "工作流", icon: GitBranch },
  { id: "chat", title: "对话", icon: MessageSquare },
  { id: "evals", title: "评估", icon: FlaskConical },
] as const;

const modes = [
  { value: "local", label: "Local" },
  { value: "e2e", label: "E2E" },
] as const;

const palette = {
  green: { light: "138 36% 78%", dark: "138 36% 70%" },
};

// Original Lucide v0.577 nodes (ISC); v1 removed brand exports.
const Github = createLucideIcon("Github", [
  [
    "path",
    {
      d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",
      key: "body",
    },
  ],
  ["path", { d: "M9 18c-4.51 2-5-2-7-2", key: "tail" }],
]);

export function AppView(props: AppViewProps) {
  const [compact, setCompact] = useState(
    () =>
      typeof matchMedia !== "undefined" &&
      matchMedia("(max-width: 767px)").matches,
  );
  const [collapsed, setCollapsed] = useState(compact);
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => {
      setCompact(media.matches);
      setCollapsed(media.matches);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const title = pages.find((page) => page.id === props.page)?.title;
  const modeLabel = modes.find((mode) => mode.value === props.mode)?.label;
  const squadTitle = props.squads.find(
    (squad) => squad.id === props.selectedSquadId,
  )?.title;
  const expanded = !collapsed || compact;
  const avatar = (
    <Avatar role="img" aria-label="本地用户头像">
      <AvatarFallback>
        <UserRound aria-hidden="true" size={16} strokeWidth={1.5} />
      </AvatarFallback>
    </Avatar>
  );
  return (
    <ThemeProvider>
      <AccentProvider accent="green" persist={false} paletteOverrides={palette}>
        <LinkProvider>
          <TooltipProvider>
            <SidebarProvider
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
              overlay={compact}
            >
              <AppShell
                layout="workspace"
                className="basalt-ui text-basalt-foreground frogie-shell"
              >
                <AppSkipLink>跳转到主要内容</AppSkipLink>
                <Sidebar
                  aria-label={`Frogie 导航 · ${squadTitle ?? "未选择 Squad"} · ${modeLabel}`}
                >
                  {compact && (
                    <>
                      <DialogTitle className="sr-only">工作区导航</DialogTitle>
                      <DialogDescription className="sr-only">
                        选择 Squad 和页面。
                      </DialogDescription>
                    </>
                  )}
                  <SidebarHeader>
                    <Text
                      as="span"
                      className={expanded ? "frogie-brand-mark" : undefined}
                    >
                      <img
                        src={props.logoSrc}
                        alt="Frogie"
                        width={24}
                        height={24}
                      />
                    </Text>
                    {expanded && (
                      <>
                        <Text as="strong" bold>
                          Frogie
                        </Text>
                        <Badge variant="secondary" className="font-mono">
                          v{props.version}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="frogie-sidebar-collapse"
                          aria-label="收起导航"
                          onClick={() => setCollapsed(true)}
                        >
                          <PanelLeftClose
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.5}
                          />
                        </Button>
                      </>
                    )}
                  </SidebarHeader>
                  <SidebarNav aria-label="主要导航">
                    {expanded ? (
                      <Field
                        label="Squad"
                        htmlFor="squad-selector"
                        required
                        className="frogie-workspace-selector"
                      >
                        <Combobox
                          id="squad-selector"
                          items={props.squads.map((squad) => ({
                            value: squad.id,
                            label: squad.title,
                          }))}
                          value={props.selectedSquadId ?? ""}
                          onValueChange={props.onSquadChange}
                          disabled={props.busy || props.squads.length === 0}
                          placeholder="选择 Squad"
                        />
                      </Field>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SidebarIconItem
                            aria-label="展开导航"
                            onClick={() => setCollapsed(false)}
                          >
                            <PanelLeftOpen
                              aria-hidden="true"
                              size={16}
                              strokeWidth={1.5}
                            />
                          </SidebarIconItem>
                        </TooltipTrigger>
                        <TooltipContent side="right">展开导航</TooltipContent>
                      </Tooltip>
                    )}
                    {pages.map(({ id, title, icon: Icon }) => {
                      const Item = expanded ? SidebarItem : SidebarIconItem;
                      return (
                        <Tooltip key={id}>
                          <TooltipTrigger asChild>
                            <Item
                              className="frogie-nav-item"
                              active={props.page === id}
                              aria-label={title}
                              onClick={() => {
                                props.onPageChange(id);
                                if (compact) setCollapsed(true);
                              }}
                            >
                              <Icon
                                aria-hidden="true"
                                size={16}
                                strokeWidth={1.5}
                              />
                              {expanded && (
                                <Text
                                  as="span"
                                  truncate
                                  className="frogie-nav-label"
                                >
                                  {title}
                                </Text>
                              )}
                            </Item>
                          </TooltipTrigger>
                          <TooltipContent side="right">{title}</TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </SidebarNav>
                  <SidebarFooter>
                    {expanded ? (
                      <SidebarUser
                        name="本地用户"
                        email="local-user"
                        avatar={avatar}
                      />
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>{avatar}</TooltipTrigger>
                        <TooltipContent side="right">本地用户</TooltipContent>
                      </Tooltip>
                    )}
                  </SidebarFooter>
                </Sidebar>
                <AppMain aria-busy={props.busy}>
                  <AppHeader
                    className="frogie-app-header"
                    density="compact"
                    title={title}
                    {...(!compact && squadTitle
                      ? { breadcrumbs: [{ label: squadTitle }] }
                      : {})}
                    leading={
                      compact ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="展开导航"
                          onClick={(event) => {
                            event.currentTarget.focus();
                            setCollapsed(false);
                          }}
                        >
                          <Menu
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.5}
                          />
                        </Button>
                      ) : undefined
                    }
                    actions={
                      <>
                        <SegmentControl
                          aria-label="运行环境"
                          legend={<span className="sr-only">运行环境</span>}
                          className="frogie-environment"
                          value={props.mode}
                          options={modes}
                          disabled={props.busy || props.canChangeMode === false}
                          onValueChange={(value) =>
                            props.onModeChange(value as Mode)
                          }
                        />
                        {props.busy && (
                          <Text as="span" className="sr-only" role="status">
                            处理中
                          </Text>
                        )}
                        <LinkButton
                          href="https://github.com/nocoo/frogie"
                          target="_blank"
                          rel="noopener noreferrer"
                          size="icon"
                          variant="ghost"
                          aria-label="Frogie GitHub 仓库"
                        >
                          <Github
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.5}
                          />
                          <Text as="span" className="sr-only">
                            GitHub
                          </Text>
                        </LinkButton>
                        <LinkButton
                          href="https://hexly.ai/projects/frogie"
                          target="_blank"
                          rel="noopener noreferrer"
                          size="icon"
                          variant="ghost"
                          aria-label="Frogie on Hexly"
                        >
                          <Hexagon
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.5}
                          />
                          <Text as="span" className="sr-only">
                            Frogie on Hexly
                          </Text>
                        </LinkButton>
                        <ThemeToggle aria-label="切换浅色与深色主题" />
                      </>
                    }
                  />
                  <div className="frogie-island-wrap">
                    <ContentIsland
                      className={
                        props.page === "chat" || props.page === "definitions"
                          ? "frogie-island frogie-island-workspace"
                          : "frogie-island"
                      }
                    >
                      {props.page !== "chat" &&
                        props.page !== "definitions" && (
                          <PageHeader
                            title={title}
                            actions={
                              props.page === "overview" ? (
                                <Button
                                  disabled={
                                    props.busy || props.canCreateSquad === false
                                  }
                                  onClick={props.onCreateSquad}
                                  icon={
                                    <Plus
                                      aria-hidden="true"
                                      size={16}
                                      strokeWidth={1.5}
                                    />
                                  }
                                >
                                  新建 Squad
                                </Button>
                              ) : undefined
                            }
                          />
                        )}
                      {props.error !== null && (
                        <Banner
                          role="alert"
                          variant="error"
                          title="操作失败"
                          description={props.error}
                        />
                      )}
                      {props.children}
                    </ContentIsland>
                  </div>
                </AppMain>
              </AppShell>
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </LinkProvider>
      </AccentProvider>
    </ThemeProvider>
  );
}
