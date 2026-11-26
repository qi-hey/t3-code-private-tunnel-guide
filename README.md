# T3 Code 私有直连指南

面向 Agent 的 WireGuard 部署教程：让手机直接连接电脑上的 **T3 Code 原生网络服务**，支持 Windows、OpenWrt/OpenClash、爱快或其他主路由，以及 FlClash/Mihomo。

> **关于网络言论与责任归属**
>
> 网上部分讨论中的“官方免费隧道偷数据”属于第三方未经证实的指控，**不是本项目需求提出者、作者或维护者的主张**。本项目不提出、不认可、不证实该指控，也不把自建隧道当作该指控成立的证据。请勿将本教程转述为“作者确认官方偷数据”或类似结论。
>
> 本项目提供的是可自行检查的部署选择，目的在于改善连接性能、减少访问路径中的第三方中转、明确自己的信任边界。它不构成对官方服务恶意行为的认定，也不构成对其服务端行为的独立审计。

这是非官方社区教程，与上述软件项目不存在隶属关系。

## 先把项目交给 Agent

让 Agent 先读 [AGENTS.md](AGENTS.md)，再读 [部署运行手册](docs/agent-runbook.md)。可以使用以下任务描述：

```text
请按这个仓库为我的 T3 Code 配置私有直连。
先核对当前版本的官方文档和源码，再检查我的网络拓扑。
使用 T3 原生 Network access，不增加 Python 转发、轮询守护或常驻计划任务。
手机继续使用现有 FlClash，只合并这个隧道需要的节点和分流规则。
真实地址、密钥、配对码、认证令牌和设备信息只保存在仓库外的私有位置。
完成正向、反向路由和认证测试后，再清理本次替代的旧入口。
最后说明实际测过什么、尚未测过什么，以及如何回退。
```

原有任务授权继续有效。Agent 不应为了每个可逆步骤重复索要确认，也不能把“已配置”说成“手机端已实测成功”。

## 架构

```mermaid
flowchart LR
    P["手机：T3 App + FlClash"]
    R["主路由：公网 UDP 端口映射"]
    W["OpenWrt：WireGuard 终点"]
    T["电脑：T3 原生 Network access"]
    A["用户选择的 AI 服务商"]
    P -->|"WireGuard 加密 UDP"| R
    R -->|"仍是加密的 WireGuard 数据"| W
    W -->|"家中局域网 HTTP / WebSocket"| T
    T -.->|"模型请求是另一条数据路径"| A
```

OpenWrt 直接持有公网地址时，可以省略上游端口映射。家庭宽带为动态 PPPoE 或多拨时，建议配合灰云 DDNS、全公网拨号口映射、粘滞防跳动探测以及路由侧 DHCP 静态绑定，避免公网或局域网 IP 变化导致失联，见 [DDNS 与多拨防跳动](docs/ddns-and-multi-wan.md)。

**加密范围是手机到 OpenWrt。** 本教程的基础拓扑将家中局域网视为可信，OpenWrt 到电脑这一段使用 HTTP。需要保护该段时，另行配置 HTTPS，或将 WireGuard 终点部署到电脑。

“本地化”指访问通路由自己管理，不意味着模型在本地推理，也不意味着所有云连接和遥测自动消失。详见 [隐私与事实边界](docs/privacy-and-claims.md)。

## 为什么直接使用 T3 原生功能

T3 桌面端提供：

- `Settings → Sharing & access → Network access`。
- 保存网络访问设置，并由桌面客户端管理本地服务的生命周期。
- 原生配对和会话认证。
- 通过 `T3CODE_PORT` 指定端口，例如保留已有手机入口使用的端口。

无需另写 TCP 转发器，也无需通过计划任务检测 T3 是否运行。首次切换网络访问会重启客户端，正在运行的 Agent 任务可能中断。

本项目核对的源码基线为 `v0.1.12-nightly.20261124.5204`。这不是安装要求，更不代表“永远适用于最新版本”。部署前应重新核对实际安装版本；[来源清单](docs/sources.md)提供官方文档和对应源码入口。

## 阅读顺序

| 文件 | 用途 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Agent 的执行约束和交付要求 |
| [部署运行手册](docs/agent-runbook.md) | 从检查拓扑到验收、回退的完整流程 |
| [T3 原生设置](docs/native-t3.md) | Windows 设置、原生端口、旧入口迁移 |
| [DDNS 与多拨防跳动](docs/ddns-and-multi-wan.md) | 灰云动态域名、多拨映射对齐、粘滞防跳动与 DHCP 固定内网 IP |
| [OpenClash 与分流](docs/openclash.md) | 处理策略路由、回程和可选的 mark 绕行 |
| [隐私与事实边界](docs/privacy-and-claims.md) | 第三方指控的归属及自建方案的实际边界 |
| [排错与验收](docs/verification.md) | 区分握手、网络可达、认证和媒体性能 |
| [来源清单](docs/sources.md) | 官方一手资料 |

## 示例地址

所有地址均为虚构示例，不来自任何实际部署：

| 参数 | 示例 |
| --- | --- |
| 公网入口 / DDNS | `home-vpn.example.net` |
| 主路由 LAN | `192.168.50.1` |
| OpenWrt LAN | `192.168.50.2` |
| T3 电脑 LAN | `192.168.50.100` |
| WireGuard 子网 | `10.77.0.0/24` |
| OpenWrt 隧道地址 | `10.77.0.1/24` |
| 手机隧道地址 | `10.77.0.2/32` |
| 公网 WireGuard 端口 | UDP `51820` |
| T3 原生服务端口 | TCP `3773`，也可明确指定其他空闲端口 |

`example.net` 以及文中出现的 `203.0.113.10` 都是文档示例，不能直接用于实际连接。

## 配置生成器

生成器只生成私有文件，不连接路由器，不修改订阅，不安装服务。

1. 在仓库外建立私有目录，将 [输入示例](examples/inputs.example.json)作为配置结构参考。
2. 填入实际网络参数及独立生成的服务端、手机密钥对和预共享密钥。
3. 使用 Node.js 22 或更高版本运行：

```sh
node scripts/render-config.mjs --config /PRIVATE/inputs.json --out-dir /PRIVATE/new-output
```

Windows 同样使用这条命令，只需提供实际私有路径。输入文件和输出目录都必须在仓库外；输出目录必须尚不存在。

生成内容：

- OpenWrt 网络与防火墙的 UCI batch 文件。
- FlClash 增量扩展脚本。
- Mihomo JSON 配置片段，**不是完整订阅**。
- 标明禁止公开上传的提示文件。

生成文件包含私钥，不能提交到 GitHub。Windows 上应另外检查私有目录的 NTFS 权限；POSIX 的文件 mode 不等于 Windows ACL。若通过 NAS 或内网中转把 `flclash-extension.js` 传给手机，导入生效后应立即删除中转副本。

生成器检查格式和地址关系，但不证明密钥对匹配、路由正确或目标软件支持所有配置项。实际握手和业务验收不可省略。

## 本地检查

无需安装 npm 依赖：

```sh
npm test
npm run check:privacy
```

隐私检查同时检查 Git 暂存区和工作目录，涵盖尚未跟踪的非忽略文件。它不是完整的 DLP 系统，不能替代人工检查，也不会自动清除 Git 历史。

支持额外提供一个仓库外的 JSON 字符串数组，检测部署者自己的敏感值是否误入文档：

```sh
node scripts/check-privacy.mjs --deny-file /PRIVATE/values-never-publish.json
```

检查器只报告文件名和规则，不回显命中的敏感值。

## 本仓库不包含

任何实际部署者的公网地址、家庭网络地址、主机名、系统用户名、密钥、配对码、认证令牌、连接日志、截图、附件、设备指纹或聊天记录。

仓库代码不提供转发服务，不依赖常驻 Python 进程，不创建启动计划任务，也不改变 T3 的认证机制。许可见 [LICENSE](LICENSE)。
