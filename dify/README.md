# Dify 生成 App 配置

## 一次性配置

1. 在 Dify 控制台进入“工作室”，选择“导入 DSL 文件”。
2. 导入 `chatflow-generator.yml`。
3. 打开导入后的“非遗文旅咨询生成器”，把 LLM 节点模型替换为当前工作区已配置的模型。
4. 发布 Chatflow。
5. 在应用的“访问 API”页面创建 App API Key。
6. 将 Key 写入业务环境变量 `DIFY_CHAT_APP_API_KEY`。

## 知识库 API Key

在 Dify 的“知识库”页面依次打开“服务 API”和“API 密钥”，创建一个可访问全部知识库的 Key，并写入：

```dotenv
DIFY_KNOWLEDGE_API_KEY=dataset-xxxxxxxx
```

该 Key 需要在服务端保存。业务系统不使用 Dify 私有 Console API，也不把任何 Key 下发到浏览器或小程序。

## 工作流输入

业务后端调用 `/chat-messages` 时传入：

- `context`：已拼装的检索上下文。
- `citations_json`：引用编号、知识库和文档名称。
- `knowledge_scope`：本次咨询使用到的知识库范围。

知识库选择和召回由业务后端调用 Dify Knowledge Service API 完成。该方式允许新增知识库后无需修改本 Chatflow 的静态 Dataset 列表。
