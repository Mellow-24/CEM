# 澳電智能客服 LLM Wiki 頁面格式

`wiki/` 中的每个草稿以严格 JSON frontmatter 开始。系统拒绝未知、缺失或重复语义字段；文件名必须是 `<id>.md`，`id` 只能包含 Unicode 字母、数字、点、下划线和连字符，且不得形成路径。

```json
{
  "id": "stable-page-id",
  "kind": "source",
  "title": "页面标题",
  "status": "draft",
  "language": "zh-Hant",
  "sources": [
    {
      "path": "relative-source.md",
      "sourceHash": "64-character-lowercase-sha256",
      "start": 0,
      "end": 1200,
      "spanHash": "64-character-lowercase-sha256"
    }
  ],
  "links": [],
  "policyHash": "64-character-lowercase-sha256"
}
```

`kind: source` 页面只授权一个规范化提取文本区间。`kind: topic` 页面必须包含至少两份不同原始资料的区间。`sourceHash` 绑定完整原始字节，`start`/`end` 定位提取文本，`spanHash` 绑定该精确区间；客服 evidence 不能读取区间外内容。

编译器只写 `status: draft`。审核人核对导航正文、链接、规则版本、资料版本和每个授权区间后，只能将状态改为 `approved`。`lint` 要求已批准链接指向唯一的已批准页面；`publish` 将已批准页面和所需来源字节复制到不可变 release，并原子更新 `current.json`。客服预设永远不会读取 `wiki/` 草稿目录。
