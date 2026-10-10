import type { DaemonProject } from "@frogie/core/protocol";
import { Badge, Button, LayerCard, Text } from "@nocoo/basalt";
import { ScrollArea } from "@nocoo/basalt/components/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nocoo/basalt/components/table";

export interface ProjectOverviewViewProps {
  projects: readonly DaemonProject[];
  selectedProjectId: string | null;
  busy: boolean;
  onSelect(projectId: string): void;
  onToggle(projectId: string, enabled: boolean): void | Promise<void>;
  onBind(projectId: string): void | Promise<void>;
}

const states = {
  starting: { label: "启动中", variant: "warning" },
  running: { label: "运行中", variant: "success" },
  stopped: { label: "已停止", variant: "secondary" },
  error: { label: "故障", variant: "error" },
} as const;

export function ProjectOverviewView(props: ProjectOverviewViewProps) {
  return (
    <LayerCard aria-label="本机项目" aria-busy={props.busy}>
      <LayerCard.Header>
        <Text as="h2" size="sm" bold>
          本机项目
        </Text>
        <Badge variant="secondary">远端未配对</Badge>
      </LayerCard.Header>
      {props.projects.length === 0 ? (
        <LayerCard.Empty
          title="暂无项目"
          description="登记 Squad 后，在这里查看本机 Harness 与定义绑定。"
        />
      ) : (
        <ScrollArea
          className="frogie-project-table-scroll"
          orientation="horizontal"
          role="region"
          aria-label="项目列表"
          tabIndex={0}
        >
          <Table className="frogie-project-table" aria-label="本机项目列表">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">项目</TableHead>
                <TableHead scope="col">Squad / Harness</TableHead>
                <TableHead scope="col">本机状态 / 远端</TableHead>
                <TableHead scope="col">Model / Thinking</TableHead>
                <TableHead scope="col">定义摘要</TableHead>
                <TableHead scope="col">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.projects.map((project) => (
                <TableRow
                  key={project.projectId}
                  variant={
                    project.projectId === props.selectedProjectId
                      ? "selected"
                      : "default"
                  }
                >
                  <TableCell>
                    <Text
                      as="span"
                      size="sm"
                      bold
                      className="frogie-project-value"
                    >
                      {project.title}
                    </Text>
                    <Text
                      as="span"
                      variant="mono"
                      size="xs"
                      tone="muted"
                      className="frogie-project-value"
                    >
                      {project.projectId}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text
                      as="span"
                      variant="mono"
                      className="frogie-project-value"
                    >
                      {project.scope.squadId}
                    </Text>
                    <Text
                      as="span"
                      variant="mono"
                      size="xs"
                      tone="muted"
                      className="frogie-project-value"
                    >
                      {project.scope.harnessId}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <div className="frogie-project-status">
                      <Badge variant={states[project.state].variant}>
                        {states[project.state].label}
                      </Badge>
                      <Badge variant="outline">
                        {project.enabled ? "已启用" : "已停用"}
                      </Badge>
                    </div>
                    <Text
                      as="span"
                      size="xs"
                      tone="muted"
                      className="frogie-project-value"
                    >
                      远端未配对
                    </Text>
                    {project.error !== undefined && (
                      <Text
                        as="span"
                        size="xs"
                        className="frogie-project-value"
                        role="alert"
                      >
                        {project.error.code}: {project.error.message}
                      </Text>
                    )}
                  </TableCell>
                  <TableCell>
                    {project.model === undefined ? (
                      <Text as="span" size="sm" tone="muted">
                        未配置
                      </Text>
                    ) : (
                      <>
                        <Text
                          as="span"
                          variant="mono"
                          className="frogie-project-value"
                        >
                          {project.model.modelId}
                        </Text>
                        <Text
                          as="span"
                          size="xs"
                          tone="muted"
                          className="frogie-project-value"
                        >
                          {project.model.provider} /{" "}
                          {project.model.thinkingLevel}
                        </Text>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <Text
                      as="span"
                      variant="mono"
                      size="xs"
                      truncate
                      title={project.definitionHash}
                      className="frogie-project-hash"
                    >
                      {project.definitionHash}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <div className="frogie-project-actions">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={props.busy}
                        aria-label={`${project.enabled ? "停用" : "启用"}项目 ${project.title}`}
                        onClick={() =>
                          props.onToggle(project.projectId, !project.enabled)
                        }
                      >
                        {project.enabled ? "停用" : "启用"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={props.busy}
                        aria-label={`进入项目 ${project.title}`}
                        onClick={() => props.onSelect(project.projectId)}
                      >
                        进入
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={props.busy}
                        aria-label={`为项目 ${project.title} 绑定最新定义`}
                        onClick={() => props.onBind(project.projectId)}
                      >
                        绑定最新定义
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </LayerCard>
  );
}
