"use client";

import { getCategoryMeta } from "@/lib/categories";
import { formatCurrency } from "@/lib/format";
import { buildSpendingFlow, type FlowItem } from "@/lib/spending-flow";
import type { Transaction } from "@/lib/types";

interface FlowNode extends FlowItem {
  color: string;
}

function ribbon(x1: number, x2: number, y1: number, y2: number, width: number) {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}
    L ${x2} ${y2 + width} C ${mid} ${y2 + width}, ${mid} ${y1 + width}, ${x1} ${y1 + width} Z`;
}

export default function SpendingFlow({ transactions, periodLabel }: { transactions: Transaction[]; periodLabel: string }) {
  const flow = buildSpendingFlow(transactions);
  const maxSources = 8;
  const shownSources = flow.sources.slice(0, maxSources);
  const remainingSources = flow.sources.slice(maxSources);
  const left: FlowNode[] = shownSources.map(item => ({ ...item, key: `income:${item.key}`, color: "#00b894" }));
  if (remainingSources.length > 0) {
    left.push({
      key: "remaining-income-sources",
      label: "Other income sources",
      amount: remainingSources.reduce((sum, item) => sum + item.amount, 0),
      color: "#00b894",
    });
  }
  if (flow.shortfall > 0) {
    left.push({ key: "shortfall", label: "Income shortfall", amount: flow.shortfall, color: "#fdcb6e" });
  }
  const right: FlowNode[] = flow.categories.map(item => {
    const category = getCategoryMeta(item.key);
    return { ...item, key: `expense:${item.key}`, label: category.label, color: category.color };
  });
  if (flow.remainder > 0) {
    right.push({ key: "remainder", label: "Income less spending", amount: flow.remainder, color: "#a29bfe" });
  }
  const total = Math.max(flow.totalIncome, flow.totalExpenses);

  if (total === 0) {
    return <p className="rounded-xl border border-border/40 p-6 text-center text-sm text-foreground/50">No income or spending to show for {periodLabel}. Transfers and ignored transactions are excluded.</p>;
  }

  const height = Math.max(320, Math.max(left.length, right.length) * 55 + 50);
  const chartHeight = height - 68;
  const gap = 24;
  const scale = (chartHeight - gap * (Math.max(left.length, right.length) - 1)) / total;
  const centerY = (height - total * scale) / 2;

  function drawNodes(nodes: FlowNode[], side: "left" | "right") {
    const x = side === "left" ? 205 : 595;
    const centralX = side === "left" ? 390 : 410;
    const totalHeight = nodes.reduce((sum, node) => sum + node.amount * scale, 0) + gap * (nodes.length - 1);
    let nodeY = (height - totalHeight) / 2;
    let centerOffset = centerY;
    return nodes.map(node => {
      const width = node.amount * scale;
      const y = nodeY;
      const center = centerOffset;
      nodeY += width + gap;
      centerOffset += width;
      return (
        <g key={`${side}-${node.key}`}>
          <path
            d={side === "left" ? ribbon(x, centralX, y, center, width) : ribbon(centralX, x, center, y, width)}
            fill={node.color}
            fillOpacity={0.28}
          />
          <rect x={side === "left" ? x - 5 : x} y={y} width={5} height={width} fill={node.color} />
          <text x={side === "left" ? x - 12 : x + 12} y={y + width / 2 - 3}
            textAnchor={side === "left" ? "end" : "start"} fill="currentColor" fontSize="11">
            {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
          </text>
          <text x={side === "left" ? x - 12 : x + 12} y={y + width / 2 + 11}
            textAnchor={side === "left" ? "end" : "start"} fill="currentColor" opacity={0.65} fontSize="10">
            {formatCurrency(node.amount)}
          </text>
          <title>{node.label}: {formatCurrency(node.amount)}</title>
        </g>
      );
    });
  }

  return (
    <section aria-label={`Income and spending flow for ${periodLabel}`} className="rounded-xl border border-border/40 bg-background/40 p-3 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-foreground">Income to spending</h3>
        <span className="text-xs text-foreground/50">{periodLabel}</span>
      </div>
      <p className="mt-1 text-xs text-foreground/50">All transactions in this period, excluding transfers and ignored transactions. List filters do not affect this chart.</p>
      <p className="mt-1 text-xs text-foreground/40 sm:hidden">Swipe horizontally to see the full diagram.</p>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 800 ${height}`} className="mx-auto w-full min-w-[560px] lg:min-w-0 text-foreground" role="img"
          aria-label={`Recorded income ${formatCurrency(flow.totalIncome)}, spending ${formatCurrency(flow.totalExpenses)}${flow.shortfall > 0 ? `, income shortfall ${formatCurrency(flow.shortfall)}` : `, income less spending ${formatCurrency(flow.remainder)}`}.`}>
          <text x="10" y="16" fill="currentColor" opacity={0.6} fontSize="11">INCOME SOURCES</text>
          <text x="595" y="16" fill="currentColor" opacity={0.6} fontSize="11">SPENDING CATEGORIES</text>
          {drawNodes(left, "left")}
          {drawNodes(right, "right")}
          <rect x={390} y={centerY} width={20} height={total * scale} rx={3} fill="#6c5ce7" />
        </svg>
      </div>
      <div className="sr-only">
        <p>Income sources:</p>
        <ul>{flow.sources.map(source => <li key={source.key}>{source.label}: {formatCurrency(source.amount)}</li>)}</ul>
        <p>Spending categories:</p>
        <ul>{flow.categories.map(category => <li key={category.key}>{getCategoryMeta(category.key).label}: {formatCurrency(category.amount)}</li>)}</ul>
      </div>
      <p className="mt-2 text-xs text-foreground/45">
        {flow.shortfall > 0
          ? `Spending exceeded recorded income by ${formatCurrency(flow.shortfall)}; the shortfall is not an identified income source.`
          : `Income less spending: ${formatCurrency(flow.remainder)}. This is not necessarily money saved.`}
      </p>
    </section>
  );
}
