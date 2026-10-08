# 操作复盘

## GitHub 分页查询

复核 issue 和 PR 清理结果时，将 `gh api --paginate --slurp` 与 `--jq` 组合使用，本机 CLI 拒绝了该参数组合。改用 `--slurp` 输出完整 JSON，再交给独立解析器，已确认 open issue 和 PR 均为零。

后续分页汇总采用独立解析器，并启用 `pipefail`，让上游请求失败能够传递到整条命令。
