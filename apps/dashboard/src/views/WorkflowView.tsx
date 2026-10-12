import type {
  RoleDefinition,
  WorkflowDefinition,
} from "@frogie/core/definitions";
import {
  Badge,
  Button,
  DescriptionList,
  Field,
  Input,
  LayerCard,
  Text,
} from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { useTheme } from "@nocoo/basalt/providers/theme";
import {
  Background,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { Minus, Plus, Scan } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SelectionField } from "./SelectionField.js";
import "@xyflow/react/dist/base.css";

export interface WorkflowViewProps {
  workflow: WorkflowDefinition | undefined;
  workflows: readonly WorkflowDefinition[];
  roles: readonly RoleDefinition[];
  selectedNodeId: string | null;
  busy: boolean;
  dirty: boolean;
  error: string | null;
  onSelectWorkflow(id: string): void;
  onSelectNode(id: string | null): void;
  onMoveNode(id: string, position: { x: number; y: number }): void;
  onConnect(source: string, target: string): void;
  onAddNode(roleId: string): void;
  onRemoveNode(id: string): void;
  onSave(): void | Promise<void>;
  onEditRole(roleId: string): void;
}

type StepNode = Node<
  {
    title: string;
    roleId: string;
    role: RoleDefinition | undefined;
    entry: boolean;
  },
  "step"
>;

const roleTransferType = "application/x-frogie-role";

function WorkflowStep({ data, isConnectable }: NodeProps<StepNode>) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        aria-label={`${data.title} 输入端口`}
      />
      <LayerCard padding="md" outlined className="frogie-workflow-node">
        <div className="frogie-workflow-node-heading">
          <Text as="span" size="sm" bold>
            {data.title}
          </Text>
          {data.entry && <Badge variant="secondary">入口</Badge>}
        </div>
        <Text size="sm" tone="muted">
          {data.role?.title ?? data.roleId}
        </Text>
        <Text variant="mono" size="xs" tone="muted">
          {data.role?.model?.modelId ?? "继承模型"} /{" "}
          {data.role?.thinkingLevel ?? "继承思考等级"}
        </Text>
      </LayerCard>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        aria-label={`${data.title} 输出端口`}
      />
    </>
  );
}

const nodeTypes = { step: WorkflowStep };

function WorkflowInspector(
  props: WorkflowViewProps & { workflow: WorkflowDefinition },
) {
  const [targetId, setTargetId] = useState("");
  const node = props.workflow.nodes.find(
    (item) => item.id === props.selectedNodeId,
  );
  const role = props.roles.find((item) => item.id === node?.role);
  return (
    <LayerCard aria-label="步骤属性" className="frogie-workflow-inspector">
      <LayerCard.Header className="frogie-card-heading">
        <Text as="h2" size="sm" bold>
          步骤属性
        </Text>
        {node !== undefined && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => props.onSelectNode(null)}
          >
            收起
          </Button>
        )}
      </LayerCard.Header>
      {node === undefined ? (
        <LayerCard.Empty
          title="选择步骤"
          description="点击画布节点，查看角色、坐标与连接操作。"
        />
      ) : (
        <>
          <LayerCard.Body className="frogie-workflow-inspector-body">
            <DescriptionList columns={1}>
              <DescriptionList.Item term="步骤">
                {node.title}
              </DescriptionList.Item>
              <DescriptionList.Item term="节点 ID">
                <Text variant="mono">{node.id}</Text>
              </DescriptionList.Item>
              <DescriptionList.Item term="Role">
                <Text as="p">{role?.title ?? node.role}</Text>
                <Text as="p" variant="mono" size="xs" tone="muted">
                  {node.role}
                </Text>
              </DescriptionList.Item>
              <DescriptionList.Item term="Model / Thinking">
                {role?.model?.modelId ?? "继承模型"} /{" "}
                {role?.thinkingLevel ?? "继承思考等级"}
              </DescriptionList.Item>
              <DescriptionList.Item term="Skills">
                {role?.skills.join(", ") || "无"}
              </DescriptionList.Item>
              <DescriptionList.Item term="Tools / Scripts">
                {role?.tools.join(", ") || "无"} /{" "}
                {role?.scripts.join(", ") || "无"}
              </DescriptionList.Item>
            </DescriptionList>
            <Button
              variant="outline"
              disabled={props.busy || role === undefined}
              onClick={() => props.onEditRole(node.role)}
            >
              打开 Role 定义文件
            </Button>
            <div className="frogie-workflow-coordinates">
              {(["x", "y"] as const).map((axis) => (
                <Field
                  key={axis}
                  label={`${axis.toUpperCase()} 坐标`}
                  htmlFor={`workflow-coordinate-${axis}`}
                >
                  <Input
                    id={`workflow-coordinate-${axis}`}
                    type="number"
                    value={node.position[axis]}
                    disabled={props.busy}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value))
                        props.onMoveNode(node.id, {
                          ...node.position,
                          [axis]: value,
                        });
                    }}
                  />
                </Field>
              ))}
            </div>
            <Field label="连接到步骤" htmlFor="workflow-connect-target">
              <SelectionField
                id="workflow-connect-target"
                items={props.workflow.nodes
                  .filter((item) => item.id !== node.id)
                  .map((item) => ({ value: item.id, label: item.title }))}
                value={targetId}
                onValueChange={setTargetId}
                disabled={props.busy}
                placeholder="选择目标步骤"
              />
            </Field>
            <Button
              variant="outline"
              disabled={
                props.busy ||
                !props.workflow.nodes.some(
                  (item) => item.id === targetId && item.id !== node.id,
                )
              }
              onClick={() => props.onConnect(node.id, targetId)}
            >
              连接步骤
            </Button>
          </LayerCard.Body>
          <LayerCard.Footer>
            <Button
              variant="destructive"
              disabled={props.busy}
              onClick={() => props.onRemoveNode(node.id)}
            >
              删除步骤
            </Button>
          </LayerCard.Footer>
        </>
      )}
    </LayerCard>
  );
}

function WorkflowEditor(
  props: WorkflowViewProps & { workflow: WorkflowDefinition },
) {
  const { theme } = useTheme();
  const [roleId, setRoleId] = useState("");
  const flow = useReactFlow<StepNode>();
  const inspectorOpen = props.selectedNodeId !== null;
  useEffect(() => {
    if (!inspectorOpen) return;
    const frame = requestAnimationFrame(
      () => void flow.fitView({ maxZoom: 1 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [flow, inspectorOpen]);
  const projectedNodes = useMemo<StepNode[]>(
    () =>
      props.workflow.nodes.map((node) => ({
        id: node.id,
        type: "step",
        position: { ...node.position },
        selected: node.id === props.selectedNodeId,
        ariaLabel: `${node.title} · ${node.role}`,
        data: {
          title: node.title,
          roleId: node.role,
          role: props.roles.find((role) => role.id === node.role),
          entry: props.workflow.entry === node.id,
        },
      })),
    [
      props.workflow.nodes,
      props.workflow.entry,
      props.roles,
      props.selectedNodeId,
    ],
  );
  const [nodes, setNodes, applyNodeChanges] = useNodesState(projectedNodes);
  useEffect(() => {
    setNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      return projectedNodes.map((node) => {
        const current = currentById.get(node.id);
        // Preserve React Flow measurements and active drag state across VM projections.
        return {
          ...current,
          ...node,
          position: current?.dragging ? current.position : node.position,
        };
      });
    });
  }, [projectedNodes, setNodes]);
  return (
    <div className="frogie-workflow-editor">
      <LayerCard
        className="frogie-workflow-canvas-card"
        aria-label="工作流画布"
      >
        <LayerCard.Header className="frogie-workflow-canvas-toolbar">
          <Field
            label="Role"
            htmlFor="workflow-add-role"
            className="frogie-workflow-role-selector"
          >
            <SelectionField
              id="workflow-add-role"
              items={props.roles.map((role) => ({
                value: role.id,
                label: role.title,
              }))}
              value={roleId}
              onValueChange={setRoleId}
              disabled={props.busy || props.roles.length === 0}
              placeholder="选择角色"
            />
          </Field>
          <Button
            variant="outline"
            disabled={
              props.busy || !props.roles.some((role) => role.id === roleId)
            }
            draggable={
              !props.busy && props.roles.some((role) => role.id === roleId)
            }
            onDragStart={(event) => {
              event.dataTransfer.setData(roleTransferType, roleId);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => props.onAddNode(roleId)}
            title="点击添加，或拖入画布"
          >
            添加步骤
          </Button>
          <div className="frogie-workflow-viewport-actions">
            <Button
              size="icon"
              variant="ghost"
              aria-label="缩小画布"
              onClick={() => void flow.zoomOut()}
            >
              <Minus aria-hidden="true" size={16} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="放大画布"
              onClick={() => void flow.zoomIn()}
            >
              <Plus aria-hidden="true" size={16} />
            </Button>
            <Button
              variant="outline"
              icon={<Scan aria-hidden="true" size={16} />}
              onClick={() => void flow.fitView()}
            >
              适配全图
            </Button>
          </div>
        </LayerCard.Header>
        <div className="frogie-workflow-canvas">
          <ReactFlow<StepNode>
            colorMode={theme}
            nodes={nodes}
            edges={props.workflow.edges.map((edge, index) => ({
              ...edge,
              id: JSON.stringify([edge.source, edge.target, index]),
              markerEnd: { type: MarkerType.ArrowClosed },
            }))}
            nodeTypes={nodeTypes}
            nodesDraggable={!props.busy}
            selectNodesOnDrag={false}
            nodesConnectable={!props.busy}
            edgesReconnectable={false}
            deleteKeyCode={null}
            multiSelectionKeyCode={null}
            selectionOnDrag={false}
            onNodeClick={(_, node) => props.onSelectNode(node.id)}
            onPaneClick={() => props.onSelectNode(null)}
            onNodesChange={(changes) => {
              applyNodeChanges(changes);
              for (const change of changes) {
                if (
                  change.type === "position" &&
                  change.position !== undefined &&
                  !props.busy
                )
                  props.onMoveNode(change.id, change.position);
                if (change.type === "select" && change.selected)
                  props.onSelectNode(change.id);
              }
            }}
            onConnect={({ source, target }) => {
              if (!props.busy) props.onConnect(source, target);
            }}
            onDragOver={(event) => {
              if (
                !props.busy &&
                event.dataTransfer.types.includes(roleTransferType)
              ) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const droppedRole = event.dataTransfer.getData(roleTransferType);
              if (
                !props.busy &&
                props.roles.some((role) => role.id === droppedRole)
              )
                props.onAddNode(droppedRole);
            }}
            fitView
            fitViewOptions={{ maxZoom: 1 }}
          >
            <Background />
            {nodes.length === 0 && (
              <Panel
                position="top-center"
                className="frogie-workflow-canvas-empty"
              >
                <LayerCard.Empty
                  title="暂无步骤"
                  description="选择 Role 后添加步骤，或将“添加步骤”拖入画布。"
                />
              </Panel>
            )}
          </ReactFlow>
        </div>
      </LayerCard>
      {inspectorOpen && (
        <WorkflowInspector key={props.selectedNodeId} {...props} />
      )}
    </div>
  );
}

export function WorkflowView(props: WorkflowViewProps) {
  return (
    <div className="frogie-workflow-view" aria-busy={props.busy}>
      <LayerCard>
        <LayerCard.Header className="frogie-workflow-toolbar">
          <Field
            label="Workflow"
            htmlFor="workflow-selector"
            className="frogie-workflow-selector"
          >
            <SelectionField
              id="workflow-selector"
              items={props.workflows.map((workflow) => ({
                value: workflow.id,
                label: workflow.title,
              }))}
              value={props.workflow?.id ?? ""}
              onValueChange={props.onSelectWorkflow}
              disabled={props.busy || props.workflows.length === 0}
              placeholder="选择工作流"
            />
          </Field>
          {props.dirty && <Badge variant="warning">未保存</Badge>}
          <Button
            variant="outline"
            disabled={
              props.busy || !props.dirty || props.workflow === undefined
            }
            onClick={props.onSave}
          >
            保存工作流
          </Button>
        </LayerCard.Header>
      </LayerCard>
      {props.error !== null && (
        <Banner
          role="alert"
          variant="error"
          title="工作流操作失败"
          description={props.error}
        />
      )}
      {props.workflow === undefined ? (
        <LayerCard>
          <LayerCard.Empty
            title="选择工作流"
            description="从已有 Workflow 打开步骤图。"
          />
        </LayerCard>
      ) : (
        <ReactFlowProvider key={props.workflow.id}>
          <WorkflowEditor {...props} workflow={props.workflow} />
        </ReactFlowProvider>
      )}
    </div>
  );
}
