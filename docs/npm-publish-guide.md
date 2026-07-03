# npm 发布流程

## 前置条件

- npm 个人账号已注册，已开启 2FA
- npm Granular Access Token 已创建（Read and Publish 权限，Bypass 2FA）
- Token 已添加到 GitHub 仓库 Secrets（`NPM_TOKEN`）

## 发布步骤

### 1. 确认版本号

```bash
# 查看当前版本
grep '"version"' package.json
```

### 2. 创建发布 tag

```bash
# 以 v0.1.0 为例，替换为实际版本号
git tag v0.1.0
git push origin v0.1.0
```

### 3. 触发 CI 自动发布

push tag 到 GitHub 后，Actions 自动执行：

1. **test** job — Node 18/20/22 矩阵跑类型检查 + 单元测试 + E2E 测试
2. **publish** job — 全部测试通过后执行 `npm publish`

### 4. 验证发布结果

```bash
# 查看 CI 执行状态
# GitHub 仓库 → Actions 标签 → 对应 workflow run

# 确认包已发布
npm view @preprocess-cn/nano-code

# 安装验证
npm install -g @preprocess-cn/nano-code
nano-code --version
```

## 故障排查

| 问题 | 解决方法 |
|------|---------|
| 测试失败，publish 未执行 | 修复代码后删 tag 重新打：`git tag -d v0.1.0 && git push origin :refs/tags/v0.1.0` |
| npm publish 报 403 | 确认 NPM_TOKEN 在 GitHub Secrets 中存在且未过期 |
| npm publish 报需要 2FA | 确认创建 token 时勾选了 Bypass 2FA |
| 包名冲突 | `npm view @preprocess-cn/nano-code` 确认组织 scope 正确 |

## CI 配置参考

`.github/workflows/ci.yml` 中 publish job 的关键片段：

```yaml
publish:
  if: startsWith(github.ref, 'refs/tags/v')
  needs: test
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        registry-url: https://registry.npmjs.org
    - run: npm ci
    - run: npm run build
    - run: npm publish  # private repo: 不加 --provenance
      env:
        NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
