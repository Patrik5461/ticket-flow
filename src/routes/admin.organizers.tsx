import { createFileRoute } from '@tanstack/react-router'

/** Placeholder — filled in a later block of Phase 5. */
export const Route = createFileRoute('/admin/organizers')({
  component: Placeholder,
})

function Placeholder() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Organizátori</h1>
      <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">
        Táto sekcia pribudne v ďalšom bloku Fázy 5.
      </p>
    </div>
  )
}
