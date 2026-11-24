# Agent 部署运行手册

目标：手机使用现有 FlClash，通过自己的 WireGuard 连接电脑上的 T3 原生服务。

这不是“一键覆盖配置”脚本。Agent 应按下列步骤检查、执行、验证，真实参数只记录在仓库外。

## 1. 先确认现场

收集并确认：

- T3 桌面版与手机端版本、实际安装路径、实际 T3 home。
- 主路由是否持有可被外部访问的公网地址，是否存在上游 NAT / CGNAT。
- OpenWrt 地址、电脑地址、电脑默认网关、上游端口映射入口。
- OpenClash 运行模式及 Mihomo 内核是否支持 WireGuard。
- 手机 FlClash 当前配置的扩展机制；不要假设所有版本的菜单名称一致。
- 未占用的 UDP 端口、T3 原生 TCP 端口、未与任何现有路由重叠的 WireGuard 子网。
- 是否需要保留既有手机地址，是否希望另行关闭官方 T3 Connect。

将 `examples/inputs.example.json` 的结构复制到**仓库外的私有文件**后填入参数。公网地址不稳定时优先规划 DDNS；确认手机端会重新解析变化后的地址。

如果没有可达公网入口，本拓扑不能靠修改几条规则自动穿过 CGNAT。应先选择合适的可达路径，不可宣称本教程已经解决该网络条件。

## 2. 核对原生接口

阅读当前版本的官方远程访问文档，核对 `Network access`、原生配对和 `T3CODE_PORT`。见 [原生设置](native-t3.md)。

先解决原生网络服务。不要因为尚未找到设置入口就新建 Python 转发、端口代理、系统服务或轮询计划任务。

原生服务可使用默认端口；已有手机入口使用其他端口时，也可由原生 T3 直接接管该端口。必须先核对端口归属，不能停止未知进程。

## 3. 备份及密钥

在实际设备的私有位置保存：

- 即将修改的 OpenWrt `network`、`firewall` 和相关 OpenClash 配置。
- 将修改的主路由端口映射记录。
- T3 桌面设置、现有端口变量及本次变更记录。

检查 `uci changes`。存在与本任务无关的未提交变更时，不得用一次 `uci commit` 顺手提交它们。

生成服务端和手机各自的密钥对，另生成预共享密钥。具备 `wireguard-tools` 时可使用：

```sh
umask 077
wg genkey > server.key
wg pubkey < server.key > server.pub
wg genkey > phone.key
wg pubkey < phone.key > phone.pub
wg genpsk > tunnel.psk
```

这些命令只能在新的私有目录运行，不能覆盖已有部署的密钥。私钥不得打印到公共日志。生成器只验证密钥编码格式；仍需确认每个公钥确实来自对应私钥。

## 4. 配置 OpenWrt

先识别发行版、内核和包管理器。需要安装时使用该发行版匹配的 WireGuard 组件，不能盲目升级整机或混用其他版本的内核包。

生成私有配置：

```sh
node scripts/render-config.mjs --config /PRIVATE/inputs.json --out-dir /PRIVATE/new-output
```

生成器保留以下专属名称，部署前检查其不存在或确属本任务：

```text
network.wg_t3
network.t3_phone
firewall.t3_wg
firewall.t3_wg_udp
firewall.t3_wg_t3
```

检查真实的 ingress zone 和 LAN zone。上游主路由将 UDP 转给旁路 OpenWrt 时，数据可能从 OpenWrt 的 `lan` zone 进入；OpenWrt 直接面向公网时通常是其他 zone。**按真实入口设置，不能机械复制示例。**

将生成文件私下传到 OpenWrt，再应用 batch、检查并提交：

```sh
uci batch < /PRIVATE/openwrt-network.uci
uci batch < /PRIVATE/openwrt-firewall.uci
fw4 check
uci commit network
uci commit firewall
ubus call network reload
/etc/init.d/firewall reload
```

上述提交步骤以预检查没有无关 pending changes 为前提。检查失败时先修复本次变更，不能继续提交和重载。

生成规则允许手机隧道地址访问**指定电脑的一个 T3 TCP 端口**；不增加整个隧道 zone 到 LAN 的通用 forwarding。它限制的是穿过本隧道的流量，不等于把 T3 的其他 LAN 接入一并禁用。

## 5. 上游主路由与回程

在爱快或其他主路由添加一条映射：

```text
公网 UDP 51820 -> OpenWrt LAN 地址 UDP 51820
```

实际端口以输入参数为准。多 WAN 应明确映射接口及回程，不能覆盖现有端口映射。**不要把 T3 的 HTTP/TCP 端口映射到公网。**

配置 WireGuard 不要求打开爱快 SSH。已有管理界面或授权 API 足够完成端口映射。

回程必须成立：

- 电脑以 OpenWrt 为网关：确认 OpenWrt 已有到手机隧道地址的路由。
- 电脑以主路由为网关：在合适的位置添加到 WireGuard 子网、下一跳为 OpenWrt 的明确路由。
- 不要靠更改整台电脑的默认网关“试试看”；也不要默认用 SNAT 掩盖错误回程。

示例检查：

```sh
wg show wg_t3
ip route get 192.168.50.100
ip rule show
```

电脑端还应检查到 `10.77.0.2` 的返回路由。地址均应换成现场私有记录中的实际值。

## 6. 保持 OpenClash 正常工作

参照 [OpenClash 与分流](openclash.md)，确认：

1. WireGuard 自身的外层 UDP 直接访问家庭入口。
2. 隧道解密后的 T3 请求和返回流量不会再次进入透明代理。
3. 其他应用仍使用原来的分流、DNS 和默认路由。

先观察已有绕行规则和策略路由。只有确认具体 `mark` 干扰后，才考虑附带的定向 nftables 示例。

## 7. 合并手机 FlClash 配置

在当前版本支持的配置扩展入口使用生成的 `flclash-extension.js`。它添加一个 WireGuard 节点，并把指定电脑、指定端口的匹配规则放在前面，保留现有订阅节点、代理组、DNS 和其他规则。

`mihomo-fragment.json` 是另一种增量参考，不是完整订阅，不能拿它覆盖现有配置。只选择一种合并方式，避免重复管理。

节点使用 `dialer-proxy: DIRECT`，不需要再把 WireGuard 外面套一层代理。手机已使用 FlClash 的 VPN/TUN 能力时，不需要同时启动另一款占用 VPN 通道的 WireGuard App。

导入后检查实际生效配置，而不是只看到“保存成功”。保持 `T3-Home-WireGuard` 为本方案专属节点名称。

## 8. 开启 T3 原生网络访问与配对

按 [原生设置](native-t3.md)操作，使用确定的原生端口。首次切换需要重启，应安排在已授权的中断窗口内。

通过 T3 自带的配对入口授权手机。配对链接和二维码也是凭据，不能上传到仓库、issue 或公开聊天。

保留既有入口的迁移可以继续使用同一地址和端口，但仍需检查原有会话是否有效。新设备使用新的配对凭据。

## 9. 分层验收

完整方法见 [排错与验收](verification.md)。至少确认：

- 最新握手确实来自本次手机测试；不只看到 peer 配置存在。
- 手机切到蜂窝网络后可访问 T3，避免同一 Wi-Fi 测试绕过公网路径。
- T3 端口由 T3 自己监听，未认证请求被拒绝，已配对客户端可使用。
- 图片及视频正常加载、拖动；记录实际大小和耗时，不宣称固定速度。
- 手机不能通过这条隧道访问路由器管理端口、电脑 SMB 或任意 LAN 主机。
- T3 正常退出时端口关闭；重开后恢复。未实际重启电脑时必须明确标注。

测试机、临时 peer、临时认证会话和抓包文件在测试后按所属范围清理。不能删除其他设备的 peer。

## 10. 清理旧入口与交付

仅在原生路径验证通过后：

1. 停止并删除本次替代的转发进程、常驻检测及启动任务。
2. 核对进程路径、任务 action 和端口 owner，不能按模糊名称批量删除。
3. 清理只属于旧转发的脚本、缓存和日志；保留必要私有配置备份。
4. 若用户要求，单独关闭官方 T3 Connect，并验证直连仍可用。

交付报告说明原生端口、加密终点、已验证项目、未验证项目和回退位置。不要向公共仓库上传这份包含实际参数的报告。

## 回退原则

回退前先确认备份之后是否发生其他修改。优先撤销本次新建的专属配置，不能整份覆盖别人后来修改的网络、订阅或设置。

T3 可以通过原生设置关闭 Network access，并恢复原来的 `T3CODE_PORT`。重启后复核实际监听。撤销 UDP 映射时，只撤销本次新增条目。

如果旧入口仍被需要，先恢复并验证它，再结束迁移。不能把“保留了备份”写成“已经成功回退”。
