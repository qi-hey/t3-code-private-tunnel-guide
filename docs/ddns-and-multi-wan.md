# 动态公网 IP（灰云 DDNS）、多拨对齐与防跳动

家庭宽带多数使用动态 PPPoE 公网 IPv4，运营商通常会在 1–7 天内或重拨后更换公网地址。如果在手机 FlClash 扩展脚本里直接写死当时的公网 IP，宽带一旦重拨，WireGuard 握手会永久停在旧 IP 失效的时刻，手机 T3 Code 随后就会静默回退到备用线路（如 `T3 Connect`）。

本节总结面向 Agent 的动态公网 IP 持久化部署规范。文中所有域名、地址与接口名称均为示例，真实部署必须替换为现场私有参数。

## 1. 使用纯 DNS（灰云）专用子域名

WireGuard 使用纯 UDP 协议传输，**不能经过 Cloudflare 橙云（HTTP/HTTPS 代理）**。如果为 WireGuard 域名开启代理，UDP 握手包不会转发到家庭路由。

建议配置：

- **专用子域名**：使用独立子域名（例如 `home-vpn.example.net` 或 `wg.example.net`），也可以选用账号下与现有 Web 服务隔离的另一独立域名。
- **记录类型与属性**：IPv4 `A` 记录，关闭代理（Cloudflare 灰云 / `proxied: false`），设置较短的 `TTL`（例如 `60` 秒），缩短 IP 变更后的恢复窗口。
- **不要覆盖现有 Tunnel 域名**：如果同账号下已有域名通过 Cloudflare Tunnel（`CNAME -> *.cfargotunnel.com`）对外提供 Web 服务，**严禁把这些域名加入 DDNS 的 IPv4 更新列表**，否则会覆盖原有 `CNAME` 并导致 Web 服务中断。
- **最小权限 API Token**：为 DDNS 单独创建只包含目标域名（Zone）`Zone:Read` 和 `DNS:Edit` 权限的 API 令牌，避免使用跨多区域或高管理权限的令牌。
- **客户端规则匹配域名**：在 `inputs.json` 中把 `endpoint` 设为 DDNS 域名（而不是字面公网 IP），`scripts/render-config.mjs` 会自动生成 `DOMAIN,home-vpn.example.net,DIRECT` 与 `dialer-proxy: DIRECT`，防止公网 IP 变更后旧 `IP-CIDR` 直连规则失效。

## 2. 多拨 / 多 WAN 场景的两个关键点

部分家庭宽带会在爱快或其他主路由上配置多条 PPPoE 拨号（例如 `adsl1`–`adsl4`，同时在线 2 条且重拨时随机落在不同拨号口），同时可能还存在一条内网/CGNAT 备用宽带（例如 `10.x` 或 `100.64.0.0/10`）。此类网络容易出现两类隐蔽故障：

### 2.1 端口映射必须覆盖全部有效公网拨号口

如果在部署当天只看到 `adsl2`、`adsl3` 在线，而主路由的 WireGuard UDP 映射只勾选了 `adsl2,adsl3`，那么重拨后一旦 `adsl1` 或 `adsl4` 拿到公网 IP 且 DDNS 将其写入 DNS，外部打向该 IP 的 UDP 包就会在主路由被直接丢弃。

部署与核对要求：

1. **映射口与 DDNS 出口一一对齐**：主路由的 WireGuard UDP 端口映射（如 UDP `51820 -> OpenWrt LAN:51820`）应覆盖**全部可能拿到公网 IPv4 的拨号接口**（如 `adsl1,adsl2,adsl3,adsl4`），不要遗漏当前暂未拨上的同组拨号口。
2. **排除 CGNAT / 内网 WAN**：在主路由策略分流中确保 DDNS 客户端（例如 `ddns-go` 容器或路由器脚本）只从公网拨号组出站，同时在探测脚本中过滤私网及 CGNAT 网段，防止误把不可达内网地址写入 DNS。
3. **逐条外网实测**：配置完成后，从外部受控节点分别向**当前每一条在线公网 IP** 的 WireGuard UDP 端口发测试包，在 OpenWrt 核对 `/proc/net/nf_conntrack` 或防火墙计数器，确认每条公网线路都能到达 OpenWrt。

### 2.2 双拨负载均衡下的粘滞防跳动策略

当两条公网拨号同时在线且主路由对 DDNS 客户端做负载均衡时，普通 DDNS 每隔几分钟执行一次外网查 IP 请求，很可能在两个公网 IP 之间来回切换：

- 频繁触发 DNS API 写入；
- 导致手机端反复重新解析、短暂断流或重新握手。

解决办法是在 DDNS 的自定义取 IP 命令中使用**粘滞（Sticky）防跳动逻辑**，参考通用模板 [templates/ddns-sticky-ipv4.sh.example](../templates/ddns-sticky-ipv4.sh.example)：

1. 将当前生效的公网 IP 缓存在持久目录（例如容器挂载目录内）。
2. 每轮探测连续请求外网查 IP 接口最多 `N` 次（默认 `6` 次），跳过私网与 CGNAT 地址：
   - 只要在探测中再次观测到**上一次缓存的 IP**，说明该线路仍存活，立即输出该 IP 并退出（不改 DNS）；
   - 如果 `N` 次均未见到旧 IP，说明原线路已重拨或掉线，立即切换输出本轮观测到的新公网 IP 并刷新缓存，由 DDNS 在几分钟内自动完成 DNS 更新。

使用兼容 POSIX `sh` 和 `grep -oE` 的实现，可直接运行在 Alpine/BusyBox 环境的 `ddns-go` 容器或 OpenWrt/Linux 定时任务中，无需 GNU `grep -P` 扩展。

## 3. 固定电脑局域网 IP（避免内网漂移）

OpenWrt 防火墙窄放行规则与手机端 T3 入口都绑定了电脑的局域网 IP（例如 `192.168.50.100`）。如果电脑仅依赖普通动态 DHCP，租约变更或路由器重启后可能导致内网 IP 变化、隧道全部失效。

推荐做法：

- **在主路由配置 DHCP 静态地址分配**：按电脑有线网卡的真实 MAC 地址永久绑定固定 LAN IP，电脑操作系统保持 DHCP 自动获取即可。
- 相比在 Windows 中手动写死静态 IP，路由侧静态绑定既能保证 IP 稳定不变，又能在后续调整家庭网关或 DNS 时让电脑自动同步。
- 若未来更换主板、网卡或改用 Wi-Fi，只需在主路由把该条静态绑定的 MAC 更新为新网卡 MAC，其余 OpenWrt、FlClash 和 T3 配置均无需修改。

## 4. 手机脚本中转与私钥清理

生成的 `flclash-extension.js` 包含手机端的 WireGuard 私钥和预共享密钥：

- 切勿通过免认证公网链接分发该文件。
- 如果通过家庭 NAS、内网文件管理或私有云临时中转给手机下载，应限定仅本人账号可读，并在手机 FlClash 导入生效且验证握手后**立即删除中转副本**，仅在受控私有目录保留本地备份。
- 更换端口或将旧字面 IP 迁移到 DDNS 域名时，重新生成并重新导入应用 FlClash 扩展脚本即可；只要电脑地址、T3 端口与原有配对会话未变，手机 T3 Code App 无需重新配对。
