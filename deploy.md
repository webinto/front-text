# 部署

推送到 `main` 后，`.github/workflows/sync-api.yml` 自动构建并发布到 GitHub Pages，也可在 Actions 页手动触发。

一次性配置（已完成）：Settings → Pages → Source 选 **GitHub Actions**。

本地预览：

```bash
python scripts/sync.py     # 生成 reader/docs/ 与索引
python scripts/serve.py    # http://127.0.0.1:8080/
```
