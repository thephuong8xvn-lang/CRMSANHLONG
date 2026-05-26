import { type ReactNode } from 'react'

// Pulse animation via Tailwind animate-pulse
// Usage:
//   <Skeleton.KpiCard /> — 4 KPI card placeholders (grid)
//   <Skeleton.TableRows count={5} /> — N table row placeholders
//   <Skeleton.CardRows count={3} /> — N card-style list rows
//   <Skeleton.Text lines={2} /> — N text line placeholders

function Base({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-200 animate-pulse rounded ${className}`} />
}

function KpiCard() {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-3">
      <Base className="h-4 w-24" />
      <Base className="h-8 w-36" />
      <Base className="h-3 w-20" />
    </div>
  )
}

function KpiCards({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-${count} gap-4`}>
      {Array.from({ length: count }).map((_, i) => <KpiCard key={i} />)}
    </div>
  )
}

function TableRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-b border-gray-100">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Base className={`h-4 ${i === 0 ? 'w-24' : i === 1 ? 'w-40' : 'w-20'}`} />
        </td>
      ))}
    </tr>
  )
}

function TableRows({ count = 8, cols = 5 }: { count?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => <TableRow key={i} cols={cols} />)}
    </>
  )
}

function CardRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-100">
      <Base className="h-9 w-9 rounded-full shrink-0" />
      <div className="flex-1 flex flex-col gap-2">
        <Base className="h-4 w-40" />
        <Base className="h-3 w-24" />
      </div>
      <Base className="h-4 w-16" />
    </div>
  )
}

function CardRows({ count = 5 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => <CardRow key={i} />)}
    </div>
  )
}

function Text({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Base key={i} className={`h-4 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`} />
      ))}
    </div>
  )
}

// Full-page table skeleton (header + rows) used in list pages
function PageTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Toolbar placeholder */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <Base className="h-9 w-64 rounded-xl" />
        <Base className="h-9 w-24 rounded-xl" />
      </div>
      {/* Table header */}
      <div className="flex gap-4 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        {Array.from({ length: cols }).map((_, i) => (
          <Base key={i} className={`h-3.5 ${i === 0 ? 'w-24' : i === 1 ? 'w-40' : 'w-20'}`} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-100 last:border-0">
          {Array.from({ length: cols }).map((_, j) => (
            <Base key={j} className={`h-4 ${j === 0 ? 'w-24' : j === 1 ? 'w-40' : 'w-20'}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

// Wrapper that shows skeleton while loading, then renders children
function Guard({ loading, children, fallback }: { loading: boolean; children: ReactNode; fallback?: ReactNode }) {
  if (!loading) return <>{children}</>
  return <>{fallback ?? <PageTable />}</>
}

export const Skeleton = { Base, KpiCard, KpiCards, TableRow, TableRows, CardRow, CardRows, Text, PageTable, Guard }
