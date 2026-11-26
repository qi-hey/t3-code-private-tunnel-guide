# 官方来源与核对方式

教程的原生 T3 行为以官方仓库的明确版本为核对基线，而不是对安装包猜测。版本更新后，应重新核对相关文件。

## T3 Code

- [官方仓库](https://github.com/pingdotgg/t3code)
- [远程访问文档，固定版本](https://github.com/pingdotgg/t3code/blob/v0.1.12-nightly.20261124.5204/docs/user/remote-access.md)
- [桌面网络监听与访问模式](https://github.com/pingdotgg/t3code/blob/v0.1.12-nightly.20261124.5204/apps/desktop/src/backend/DesktopServerExposure.ts)
- [原生 `T3CODE_PORT` 参数](https://github.com/pingdotgg/t3code/blob/v0.1.12-nightly.20261124.5204/apps/desktop/src/app/DesktopConfig.ts)
- [设置保存与默认值](https://github.com/pingdotgg/t3code/blob/v0.1.12-nightly.20261124.5204/apps/desktop/src/settings/DesktopAppSettings.ts)
- [切换网络模式触发重启](https://github.com/pingdotgg/t3code/blob/v0.1.12-nightly.20261124.5204/apps/desktop/src/ipc/methods/serverExposure.ts)
- [桌面客户端生命周期](https://github.com/pingdotgg/t3code/blob/v0.1.12-nightly.20261124.5204/apps/desktop/src/app/DesktopLifecycle.ts)

这些资料支持原生配置能力和客户端实现的说明，不等于官方生产隧道服务端的独立审计。

## WireGuard 与 OpenWrt

- [WireGuard 协议与密码学说明](https://www.wireguard.com/protocol/)
- [WireGuard Quick Start](https://www.wireguard.com/quickstart/)
- [OpenWrt WireGuard 服务端指南](https://openwrt.org/docs/guide-user/services/vpn/wireguard/server)
- [OpenWrt UCI](https://openwrt.org/docs/guide-user/base-system/uci)
- [OpenWrt firewall4](https://openwrt.org/docs/guide-user/firewall/firewall_configuration)

本仓库的命名 section、地址规划和增量合并流程是教程方案，不是上述项目承诺的通用一键安装方式。

## FlClash、Mihomo 与 OpenClash

- [FlClash 官方仓库](https://github.com/chen08209/FlClash)
- [Mihomo WireGuard 配置](https://wiki.metacubex.one/en/config/proxies/wg/)
- [Mihomo 代理通用字段与 dialer-proxy](https://wiki.metacubex.one/en/config/proxies/)
- [Mihomo 规则](https://wiki.metacubex.one/en/config/rules/)
- [OpenClash 官方仓库](https://github.com/vernesong/OpenClash)

不同 FlClash 和内核版本对扩展入口、配置字段和 WireGuard 支持可能不同。应以实际运行内核的配置检查和握手测试为准。

## 动态域名与网络参考

- [Cloudflare DNS 代理与灰云（DNS only）说明](https://developers.cloudflare.com/dns/proxy-status/)
- [ddns-go 官方仓库](https://github.com/jeessy2/ddns-go)
- [RFC 1918：私有 IPv4 地址空间](https://datatracker.ietf.org/doc/html/rfc1918)
- [RFC 6598：共享地址空间（CGNAT `100.64.0.0/10`）](https://datatracker.ietf.org/doc/html/rfc6598)

## 示例与工具

- [RFC 5737：文档示例 IPv4 地址](https://www.rfc-editor.org/rfc/rfc5737)
- [IANA：保留的示例域名](https://www.iana.org/help/example-domains)
- [PowerShell 环境变量说明](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables)

发现文档与实际版本不符时，可以提交不含任何实际凭据、地址和日志原件的最小问题描述。
