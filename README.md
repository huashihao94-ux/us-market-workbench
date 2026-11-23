# 美股市场工作台 | US Market Workbench

与A股股票池完全独立的 **标普500 / 纳斯达克** 在线分析网页。

## 启用网页（仅需一次）
1. 进入仓库 Settings → Pages。
2. 在 Build and deployment → Source 选择 Deploy from a branch。
3. Branch 选择 main，Folder 选择 /(root)，点击 Save。
4. 等待 GitHub Pages 发布，网页地址： https://huashihao94-ux.github.io/us-market-workbench/

## 第一次获取指数行情
1. 打开仓库 Actions → Update index data → Run workflow → Run workflow。
2. 检查工作流显示绿色完成。
3. 页面点击“刷新数据”，读取最新发布的 data.json。

仓库中 .github/workflows/update.yml 将在美国交易时段附近定时重新获取数据，脚本在 scripts/update_data.py。
网页刷新只重新下载最新缓存文件，不会直接运行 Python 或实时向交易所询价。

## 功能
- 标普500（^GSPC）、纳斯达克综合指数（^IXIC）的最新可获取日收盘价。
- 最近252个交易日最高收盘价回撤%、200日均线偏离%、高点后交易日数。
- 两张历史曲线图：一年高点回撤、200日均线偏离。
- 选择2010、2012、2015、2018、2020、2025、2026历史事件，横轴对齐高点后的交易日。
- 资料表来自用户提供的视频截图，图表曲线由市场数据重新计算，两个口径可能存在差异。
- 数据源：先 Yahoo Finance，失败时尝试 Stooq。可能延迟或暂时不可用；界面标明更新时间和旧缓存，不会编造行情。

## 计算方法和限制
一年高点使用最近252个交易日**最高收盘价**，不是盘中最高价。200日均线取200个交易日收盘价简单平均。历史路径起点取事件底部前252个交易日最高收盘价。

GitHub Actions 的计划任务可能延迟、限流、无法访问数据源。GitHub Pages 静态页面**不具备逐笔实时行情**，它显示最新成功生成的数据文件。请勿直接根据历史底部中位数进行买卖决策。

公开仓库不要存储API密钥或个人隐私数据。
