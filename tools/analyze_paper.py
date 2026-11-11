#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
论文《A 股资金稳态地形-论文-MarketRank中国复现与证伪.md》的全部实测数字复算。

用法：
    python tools/analyze_paper.py

只读 data/*.js，不重跑模型，秒级完成。输出的每一块对应论文的一个小节：

    1  稳态指标                  -> §8.1
    2  行业一致性 + 打乱零模型    -> §8.3
    3  结构增益                  -> §8.4
    4  IC 与小盘对照、规模中性化  -> §9.1-9.3（论文核心）
    5  十分位多空价差            -> §9.1
    6  社群持久性                -> §10.1
    7  社群 vs 行业 NMI + 零模型 -> §10.2
    8  最后一帧排行榜与社群结构   -> §8.2 / §10.3
    9  排名持久性（top-50 重叠）  -> §10.1 补充

口径约定：
    WARM = 8  前 8 帧是预热帧（累积流量 T 尚小、地板率异常），统计一律跳过。
              IC 用 frames[WARM:] 相邻两帧配对，故为 51 个前向观测。
"""
import json
import math
import random
import statistics as st
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WARM = 8


# --------------------------------------------------------------------- 读取
def load_js(path, key):
    """data/*.js 形如 window.MR_XXX("...", {...}); 取首个 '{' 到最后的 '}'。"""
    t = path.read_text(encoding="utf-8")
    i = t.find("{", t.find(key))
    j = t.rfind("}")
    return json.loads(t[i:j + 1])


def main():
    meta = load_js(DATA / "meta.js", "MR_META")
    manifest = load_js(DATA / "manifest.js", "MR_MANIFEST")
    syms = meta["symbols"]            # [code, name, market, fine, major, is_etf, listed]
    dates = meta["dates"]
    fine = [s[3] for s in syms]
    maj = [s[4] for s in syms]
    etf = [s[5] for s in syms]
    frames = [load_js(DATA / "frames" / ("%s.js" % d), "MR_FRAME") for d in dates]

    n_sym = len(syms)
    n_etf = sum(etf)
    n_days = len(dates)

    print("=" * 66)
    print("样本：%d 只（ETF %d，%.2f%%），%d 个交易日，%s ~ %s"
          % (n_sym, n_etf, 100.0 * n_etf / n_sym, n_days, dates[0], dates[-1]))
    print("=" * 66)

    # ------------------------------------------------------------- 1 稳态指标
    print("\n[1] 稳态指标（跳过前 %d 帧，n=%d）" % (WARM, n_days - WARM))
    ss = manifest["stats"][WARM:]
    for k, label in (("active", "活跃股票"), ("floor", "地板份额"),
                     ("gini", "基尼系数"), ("coh", "行业一致性(12大类)"),
                     ("comm", "社群数"), ("iters", "幂迭代次数")):
        v = [x[k] for x in ss]
        print("    %-16s 均值 %8.4f   区间 [%.4f, %.4f]"
              % (label, st.mean(v), min(v), max(v)))

    # ------------------------------------------------- 2 行业一致性 + 零模型
    print("\n[2] 行业一致性 vs 打乱零模型")
    print("    口径同原论文：只统计【两端都是非 ETF 且行业已知】的边，")
    print("    零模型把行业标签在【同一批节点】内置换（200 次）。")
    EXCL = ("ETF/基金", "未分类", "其他")

    def eligible_mask(labels):
        return [(not etf[i]) and labels[i] not in EXCL for i in range(len(labels))]

    def coherence(edges, ok, lab):
        num = den = 0.0
        for a, b, _w, fl in edges:
            if not (ok[a] and ok[b]):
                continue
            den += fl
            if lab[a] == lab[b]:
                num += fl
        return num / den if den > 0 else None

    def coherence_test(labels, name, n_seed=200):
        ok = eligible_mask(labels)
        real = [v for v in (coherence(f["edges"], ok, labels) for f in frames[WARM:])
                if v is not None]
        idx_ok = [i for i in range(len(labels)) if ok[i]]
        null = []
        for f in frames[WARM:]:
            acc = []
            for s in range(n_seed):
                lab = labels[:]
                sub = [lab[i] for i in idx_ok]
                random.Random(41000 + s).shuffle(sub)
                for i, v in zip(idx_ok, sub):
                    lab[i] = v
                v = coherence(f["edges"], ok, lab)
                if v is not None:
                    acc.append(v)
            null.append(st.mean(acc))
        r, nu = st.mean(real), st.mean(null)
        print("    %-12s 真实 %.4f (sd %.4f)  零模型 %.4f  ->  %.2f×"
              % (name, r, st.pstdev(real), nu, r / nu))
        return r, nu

    coherence_test(fine, "104 细分行业")
    coherence_test(maj, "12 大类")
    print("    对照原论文（美股，11 个 GICS 部门，仅股票）：0.288 / 0.123  ->  2.35×")

    # --------------------------------------------------------- 3 结构增益
    def spearman(x, y):
        def rank(v):
            o = sorted(range(len(v)), key=lambda i: v[i])
            r = [0.0] * len(v)
            i = 0
            while i < len(o):
                j = i
                while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]:
                    j += 1
                a = (i + j) / 2.0 + 1.0
                for q in range(i, j + 1):
                    r[o[q]] = a
                i = j + 1
            return r
        rx, ry = rank(x), rank(y)
        n = len(x)
        mx, my = sum(rx) / n, sum(ry) / n
        num = sum((p - mx) * (q - my) for p, q in zip(rx, ry))
        den = math.sqrt(sum((p - mx) ** 2 for p in rx) * sum((q - my) ** 2 for q in ry))
        return num / den if den > 0 else 0.0

    sg = []
    for f in frames[WARM:]:
        inflow = [0.0] * f["n"]
        for _s, d, _w, fl in f["edges"]:
            inflow[d] += fl
        idx = [i for i in range(f["n"]) if f["active"][i] and inflow[i] > 0]
        sg.append(1.0 - spearman([f["score"][i] for i in idx], [inflow[i] for i in idx]))
    print("\n[3] 结构增益 1 - Spearman(score, 入边流量和) = %.4f" % st.mean(sg))
    print("    注：入边仅保留 top-6，分母被截断，与原论文的 0.248 不可直接比较。")

    # ---------------------------------------------- 4 IC / 小盘 / 规模中性化
    print("\n[4] 预测能力（核心）")

    def tstat(v):
        return st.mean(v) / (st.pstdev(v) / math.sqrt(len(v)))

    sig = {k: [] for k in ("score", "z", "neg_hot", "neg_logamt", "neg_chg", "neutral")}
    spread = []
    for k in range(WARM, len(frames) - 1):
        a, b = frames[k], frames[k + 1]
        idx = [i for i in range(a["n"])
               if a["active"][i] and a["close"][i] > 0 and b["close"][i] > 0]
        fwd = [b["close"][i] / a["close"][i] - 1.0 for i in idx]
        sig["score"].append(spearman([a["score"][i] for i in idx], fwd))
        sig["z"].append(spearman([a["z"][i] for i in idx], fwd))
        sig["neg_hot"].append(spearman([-a["hot"][i] for i in idx], fwd))
        sig["neg_logamt"].append(spearman([-math.log(max(a["amt"][i], 1.0)) for i in idx], fwd))
        sig["neg_chg"].append(spearman([-a["chg"][i] for i in idx], fwd))

        # 规模中性化：成交额十分位内去均值
        order = sorted(idx, key=lambda i: a["amt"][i])
        m = len(order)
        resid = {}
        for g in range(10):
            seg = order[g * m // 10:(g + 1) * m // 10]
            if len(seg) < 10:
                continue
            mu = st.mean([a["score"][i] for i in seg])
            for i in seg:
                resid[i] = a["score"][i] - mu
        sig["neutral"].append(spearman([resid[i] for i in idx], fwd))

        # 十分位多空
        srt = sorted(idx, key=lambda i: a["score"][i])
        lo, hi = srt[:m // 10], srt[-m // 10:]
        spread.append(st.mean([b["close"][i] / a["close"][i] - 1 for i in hi])
                      - st.mean([b["close"][i] / a["close"][i] - 1 for i in lo]))

    label = {"score": "score (pi*N)", "z": "z = log(pi/s)", "neg_hot": "-h (取负热度)",
             "neg_logamt": "-log(AMT) 小盘因子", "neg_chg": "-chg 当日反转",
             "neutral": "score 规模中性化"}
    for k in ("score", "z", "neg_hot", "neg_logamt", "neg_chg", "neutral"):
        v = sig[k]
        print("    %-22s IC=%+.5f  t=%+.2f  为正 %d/%d"
              % (label[k], st.mean(v), tstat(v),
                 sum(1 for x in v if x > 0), len(v)))
    print("    观测数 %d（前向 1 日，收盘对收盘）" % len(sig["score"]))
    print("    >> 原始 IC 显著为负，但 -log(AMT) 更强；规模中性化后翻正且不显著。")

    # ------------------------------------------------------ 5 十分位多空
    print("\n[5] 十分位多空（score 最高 10%% - 最低 10%%）")
    print("    均值 %+.4f%%/日   t=%.2f   为正 %d/%d"
          % (st.mean(spread) * 100, tstat(spread),
             sum(1 for x in spread if x > 0), len(spread)))

    # ------------------------------------------------------ 6 社群持久性
    print("\n[6] 社群持久性 NMI(t, t+k)")

    def nmi(a, b):
        n = len(a)
        ca, cb, cab = Counter(a), Counter(b), Counter(zip(a, b))
        if n < 5:
            return None

        def H(c):
            return -sum(v / n * math.log(v / n) for v in c.values())

        ha, hb = H(ca), H(cb)
        hab = -sum(v / n * math.log(v / n) for v in cab.values())
        mi = ha + hb - hab
        return 2 * mi / (ha + hb) if (ha + hb) > 0 else None

    for k in (1, 2, 5, 10, 20):
        v = []
        for i in range(WARM, len(frames) - k):
            a, b = frames[i], frames[i + k]
            idx = [j for j in range(a["n"])
                   if a["active"][j] and b["active"][j] and not etf[j]]
            r = nmi([a["comm"][j] for j in idx], [b["comm"][j] for j in idx])
            if r is not None:
                v.append(r)
        print("    k=%2d  NMI=%.3f  (n=%d)" % (k, st.mean(v), len(v)))

    base = []
    for i in range(WARM, len(frames)):
        a = frames[i]
        idx = [j for j in range(a["n"]) if a["active"][j] and not etf[j]]
        la = [a["comm"][j] for j in idx]
        lb = la[:]
        random.Random(i).shuffle(lb)
        r = nmi(la, lb)
        if r is not None:
            base.append(r)
    print("    随机基线（社群标签打乱）NMI=%.4f" % st.mean(base))

    # ------------------------------------------- 7 社群 vs 行业 + 零模型
    print("\n[7] 社群 vs 行业 NMI 与打乱零模型（剔除 ETF）")
    rf, rm, nf2, nm2 = [], [], [], []
    for i in range(WARM, len(frames)):
        a = frames[i]
        idx = [j for j in range(a["n"]) if a["active"][j] and not etf[j]]
        c = [a["comm"][j] for j in idx]
        lf = [fine[j] for j in idx]
        lm = [maj[j] for j in idx]
        rf.append(nmi(c, lf))
        rm.append(nmi(c, lm))
        random.Random(i).shuffle(lf)
        random.Random(500 + i).shuffle(lm)
        nf2.append(nmi(c, lf))
        nm2.append(nmi(c, lm))
    print("    104 细分行业  真实 %.4f  基线 %.4f  ->  %.2f×"
          % (st.mean(rf), st.mean(nf2), st.mean(rf) / st.mean(nf2)))
    print("    12 大类       真实 %.4f  基线 %.4f  ->  %.2f×"
          % (st.mean(rm), st.mean(nm2), st.mean(rm) / st.mean(nm2)))
    print("    对照原论文（美股）：真实 0.034 / 基线 0.004 / 8.5×")

    # -------------------------------------------- 8 末帧排行榜与社群结构
    last = frames[-1]
    print("\n[8] 最后一帧 %s：活跃 %d，社群 %d"
          % (last["date"], last["stats"]["active"], last["stats"]["comm"]))
    print("    #  代码    名称        细分行业      score     心跳      涨跌")
    for k, i in enumerate(last["top"][:20], 1):
        s = syms[i]
        print("    %-2d %-6s %-10s %-10s %8.2f %+8.4f %7.2f%%"
              % (k, s[0], s[1][:10], s[3], last["score"][i], last["hb"][i], last["chg"][i]))
    c50 = Counter(syms[i][3] for i in last["top"][:50])
    print("    Top50 行业前 6：", c50.most_common(6))
    print("\n    社群结构：id 只数 中位成交额(亿) 中位z 领导大类")
    all_amt = st.median([last["amt"][i] for i in range(last["n"])])
    for c in last["communities"]:
        mem = [i for i in range(last["n"]) if last["comm"][i] == c["id"]]
        ma = st.median([last["amt"][i] for i in mem])
        print("      %-3d %-5d %10.2f %8.3f  %s"
              % (c["id"], len(mem), ma / 1e8, c["z"], c["lead"]))
    print("      全市场中位成交额 %.2f 亿" % (all_amt / 1e8))

    # ------------------------------------------------------ 9 排名持久性
    print("\n[9] 排名持久性（top-50 重叠）")
    for k in (1, 5, 10, 20):
        ov = []
        for i in range(WARM, len(frames) - k):
            s1 = set(frames[i]["top"][:50])
            s2 = set(frames[i + k]["top"][:50])
            ov.append(len(s1 & s2) / 50.0)
        print("    k=%2d  %.2f" % (k, st.mean(ov)))

    print("\n" + "=" * 66)
    print("完成。以上数字与论文正文一一对应，可直接核对。")
    print("=" * 66)


if __name__ == "__main__":
    main()
