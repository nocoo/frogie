import {
  Badge,
  Button,
  Field,
  LayerCard,
  SidebarNav,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { ChatMarkdown } from "@nocoo/basalt/components/chat-markdown";
import { EditableNavItem } from "@nocoo/basalt/components/editable-nav-item";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { Loader } from "@nocoo/basalt/components/loader";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { ResponsiveMasterDetail } from "@nocoo/basalt/components/responsive-master-detail";
import { useEffect, useState } from "react";

export interface DefinitionViewFile {
  path: string;
  title: string;
}

export interface DefinitionViewProps {
  title: string;
  files: readonly DefinitionViewFile[];
  selectedPath: string | null;
  markdown: string;
  draft: string;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  creating: boolean;
  canSave: boolean;
  canCreate: boolean;
  error: string | null;
  onFileSelect(path: string): void;
  onDraftChange(value: string): void;
  onSave(): void | Promise<void>;
  onCreate(): void | Promise<void>;
}

export function DefinitionView(props: DefinitionViewProps) {
  const [detailOpen, setDetailOpen] = useState(props.selectedPath !== null);
  useEffect(() => {
    setDetailOpen(props.selectedPath !== null);
  }, [props.selectedPath]);
  return (
    <>
      <PageHeader
        title={props.title}
        actions={
          <>
            {props.dirty && <Badge variant="warning">未保存</Badge>}
            <Button
              variant="outline"
              aria-label="保存定义"
              disabled={
                !props.canSave ||
                props.loading ||
                props.saving ||
                props.creating
              }
              onClick={props.onSave}
            >
              保存
            </Button>
            <Button
              aria-label="创建定义"
              disabled={
                !props.canCreate ||
                props.loading ||
                props.saving ||
                props.creating
              }
              onClick={props.onCreate}
            >
              创建
            </Button>
          </>
        }
      />
      {props.error !== null && (
        <Banner
          role="alert"
          variant="error"
          title="定义操作失败"
          description={props.error}
        />
      )}
      {(props.loading || props.saving || props.creating) && (
        <Text role="status" aria-live="polite" size="sm" tone="muted">
          {props.loading && <Loader label="加载中" />}
          {props.saving && "保存中 "}
          {props.creating && "创建中"}
        </Text>
      )}
      <ResponsiveMasterDetail
        label="定义工作台"
        listLabel="定义文件"
        detailLabel="定义内容"
        backLabel="返回文件列表"
        selectedId={props.selectedPath}
        detailOpen={detailOpen}
        onDetailOpenChange={setDetailOpen}
        className="frogie-definition-split"
        empty={
          <LayerCard.Empty
            title="选择定义文件"
            description="从文件列表打开定义，或创建新定义。"
          />
        }
        list={
          <SidebarNav aria-label="定义文件">
            {props.files.map((file) => (
              <EditableNavItem
                key={file.path}
                label={file.title}
                selected={props.selectedPath === file.path}
                disabled={props.loading || props.saving || props.creating}
                onSelect={() => {
                  props.onFileSelect(file.path);
                  setDetailOpen(true);
                }}
              />
            ))}
            {props.files.length === 0 && (
              <Text size="sm" tone="muted">
                暂无定义文件
              </Text>
            )}
          </SidebarNav>
        }
      >
        <LayerCard className="frogie-definition-editor">
          <LayerCard.Header>
            <Text as="span" variant="mono" className="frogie-definition-path">
              {props.selectedPath}
            </Text>
          </LayerCard.Header>
          <LayerCard.Body className="frogie-definition-body">
            <Tabs defaultValue="edit" className="frogie-definition-tabs">
              <TabsList aria-label="定义展示方式">
                <TabsTrigger value="edit">源码编辑</TabsTrigger>
                <TabsTrigger value="preview">Markdown 预览</TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="frogie-definition-source">
                <Field
                  label="Markdown 源码"
                  htmlFor="definition-source"
                  required
                  className="frogie-definition-field"
                >
                  <InputArea
                    id="definition-source"
                    aria-label="Markdown 源码"
                    value={props.draft}
                    onChange={(event) =>
                      props.onDraftChange(event.target.value)
                    }
                    disabled={props.loading || props.saving || props.creating}
                    rows={12}
                    spellCheck={false}
                    className="frogie-definition-input"
                  />
                </Field>
              </TabsContent>
              <TabsContent
                value="preview"
                className="frogie-definition-preview"
              >
                <ChatMarkdown content={props.markdown} />
              </TabsContent>
            </Tabs>
          </LayerCard.Body>
        </LayerCard>
      </ResponsiveMasterDetail>
    </>
  );
}
