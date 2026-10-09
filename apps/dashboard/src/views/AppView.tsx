import {
  Badge,
  Button,
  ContentIsland,
  DialogDescription,
  DialogTitle,
  Field,
  LinkProvider,
  SegmentControl,
  Sidebar,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
  SidebarNav,
  SidebarProvider,
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
  CodeXml,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Menu,
  MessageSquare,
  PanelLeftClose,
  Plus,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

export type Page = "overview" | "definitions" | "workflows" | "chat" | "evals";
export type Mode = "local" | "e2e" | "prod";

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
  { value: "prod", label: "Prod" },
] as const;

export function AppView(props: AppViewProps) {
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => {
      setCompact(media.matches);
      setCollapsed(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const title = pages.find((page) => page.id === props.page)?.title;
  const modeLabel = modes.find((mode) => mode.value === props.mode)?.label;
  const squadTitle = props.squads.find(
    (squad) => squad.id === props.selectedSquadId,
  )?.title;
  return (
    <ThemeProvider>
      <AccentProvider defaultAccent="green">
        <LinkProvider>
          <TooltipProvider>
            <SidebarProvider
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
              overlay={compact}
            >
              <AppShell layout="responsive" className="basalt-ui">
                <AppSkipLink>跳转到主要内容</AppSkipLink>
                <Sidebar
                  aria-label={`Frogie 导航 · ${squadTitle ?? "未选择 Squad"} · ${modeLabel}`}
                >
                  {compact && (
                    <>
                      <DialogTitle className="sr-only">工作区导航</DialogTitle>
                      <DialogDescription className="sr-only">
                        选择 Squad、环境和页面。
                      </DialogDescription>
                    </>
                  )}
                  <SidebarHeader>
                    <img
                      src={props.logoSrc}
                      alt="Frogie"
                      width={24}
                      height={24}
                    />
                    {(!collapsed || compact) && (
                      <>
                        <Text as="strong" bold>
                          Frogie
                        </Text>
                        <Badge variant="secondary">v{props.version}</Badge>
                      </>
                    )}
                  </SidebarHeader>
                  {(!collapsed || compact) && (
                    <SidebarGroup label="工作区">
                      <Field label="Squad" htmlFor="squad-selector" required>
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
                      <SegmentControl
                        legend="环境"
                        value={props.mode}
                        options={modes}
                        disabled={props.busy || props.canChangeMode === false}
                        onValueChange={(value) =>
                          props.onModeChange(value as Mode)
                        }
                      />
                    </SidebarGroup>
                  )}
                  <SidebarNav aria-label="主要导航">
                    {pages.map(({ id, title, icon: Icon }) => (
                      <Tooltip key={id}>
                        <TooltipTrigger asChild>
                          <SidebarItem
                            active={props.page === id}
                            aria-current={
                              props.page === id ? "page" : undefined
                            }
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
                            <Text
                              as="span"
                              className={
                                collapsed && !compact ? "sr-only" : "truncate"
                              }
                            >
                              {title}
                            </Text>
                          </SidebarItem>
                        </TooltipTrigger>
                        <TooltipContent side="right">{title}</TooltipContent>
                      </Tooltip>
                    ))}
                  </SidebarNav>
                </Sidebar>
                <AppMain aria-busy={props.busy}>
                  <AppHeader
                    density="compact"
                    title={title}
                    leading={
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={collapsed ? "展开导航" : "收起导航"}
                        onClick={(event) => {
                          event.currentTarget.focus();
                          setCollapsed(!collapsed);
                        }}
                      >
                        {collapsed ? (
                          <Menu
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.5}
                          />
                        ) : (
                          <PanelLeftClose
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.5}
                          />
                        )}
                      </Button>
                    }
                    actions={
                      <>
                        <Badge variant="secondary">{modeLabel}</Badge>
                        {props.busy && (
                          <Text as="span" size="sm" role="status">
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
                          <CodeXml
                            aria-hidden="true"
                            size={16}
                            strokeWidth={1.5}
                          />
                          <Text as="span" className="sr-only">
                            GitHub
                          </Text>
                        </LinkButton>
                        <ThemeToggle aria-label="切换浅色与深色主题" />
                      </>
                    }
                  />
                  <ContentIsland className="space-y-basalt-layout-md">
                    <PageHeader
                      title={title}
                      actions={
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
                      }
                    />
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
