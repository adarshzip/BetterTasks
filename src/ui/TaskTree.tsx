import type { GTaskList, TaskNode } from '@/model/types'
import type { Theme } from './theme'
import { flattenTree } from '@/model/tree'
import { categoryOf } from '@/model/grouping'
import { TaskRow } from './TaskRow'

interface Props {
  nodes: TaskNode[]
  lists: GTaskList[]
  theme: Theme
  showCategory: boolean
  collapsed: ReadonlySet<string>
  onToggleCollapse: (id: string) => void
}

export function TaskTree({ nodes, lists, theme, showCategory, collapsed, onToggleCollapse }: Props) {
  const listTitles = new Map(lists.map((l) => [l.id, l.title ?? 'Untitled']))
  const rows = flattenTree(nodes, collapsed)

  return (
    <div>
      {rows.map((node) => (
        <TaskRow
          key={node.raw.id}
          node={node}
          theme={theme}
          category={categoryOf(node, listTitles)}
          showCategory={showCategory}
          collapsed={collapsed.has(node.raw.id)}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </div>
  )
}
