/**
 * v-t3.mjs — Task 3 verification script
 * Replicates summarize() logic on sample evalClauses outputs to sanity-check {first,any} mapping.
 * Run: node scripts/v-t3.mjs
 */

// ── Inline reimplementation of summarize (no imports needed) ──────────────────
function summarize(rs) {
  return { first: rs.some(r => r.first && r.fired), any: rs.some(r => r.fired) }
}

let pass = true
function check(label, got, expected) {
  const ok = got.first === expected.first && got.any === expected.any
  console.log(`${ok ? '✅' : '❌'} ${label}: first=${got.first} any=${got.any}  (expected first=${expected.first} any=${expected.any})`)
  if (!ok) pass = false
}

// Case 1: 款一① fired → first=true, any=true
check(
  '款一① fired',
  summarize([
    { id: '1①', fired: true,  first: true,  detail: '' },
    { id: '1②', fired: false, first: false, detail: '' },
    { id: '2',  fired: false, first: false, detail: '' },
    { id: '3',  fired: false, first: false, detail: '' },
    { id: '6',  fired: false, first: false, detail: '' },
    { id: '11', fired: false, first: false, detail: '' },
    { id: '12', fired: false, first: false, detail: '' },
  ]),
  { first: true, any: true }
)

// Case 2: 款一② fired only → first=true, any=true
check(
  '款一② fired only',
  summarize([
    { id: '1①', fired: false, first: false, detail: '' },
    { id: '1②', fired: true,  first: true,  detail: '' },
    { id: '2',  fired: false, first: false, detail: '' },
    { id: '3',  fired: false, first: false, detail: '' },
    { id: '6',  fired: false, first: false, detail: '' },
    { id: '11', fired: false, first: false, detail: '' },
    { id: '12', fired: false, first: false, detail: '' },
  ]),
  { first: true, any: true }
)

// Case 3: 款十一 fired only → first=false, any=true
check(
  '款十一 fired only',
  summarize([
    { id: '1①', fired: false, first: false, detail: '' },
    { id: '1②', fired: false, first: false, detail: '' },
    { id: '2',  fired: false, first: false, detail: '' },
    { id: '3',  fired: false, first: false, detail: '' },
    { id: '6',  fired: false, first: false, detail: '' },
    { id: '11', fired: true,  first: false, detail: '' },
    { id: '12', fired: false, first: false, detail: '' },
  ]),
  { first: false, any: true }
)

// Case 4: 款三 fired only → first=false, any=true
check(
  '款三 fired only',
  summarize([
    { id: '1①', fired: false, first: false, detail: '' },
    { id: '1②', fired: false, first: false, detail: '' },
    { id: '2',  fired: false, first: false, detail: '' },
    { id: '3',  fired: true,  first: false, detail: '' },
    { id: '6',  fired: false, first: false, detail: '' },
    { id: '11', fired: false, first: false, detail: '' },
    { id: '12', fired: false, first: false, detail: '' },
  ]),
  { first: false, any: true }
)

// Case 5: nothing fired → first=false, any=false
check(
  'nothing fired',
  summarize([
    { id: '1①', fired: false, first: false, detail: '' },
    { id: '1②', fired: false, first: false, detail: '' },
    { id: '2',  fired: false, first: false, detail: '' },
    { id: '3',  fired: false, first: false, detail: '' },
    { id: '6',  fired: false, first: false, detail: '' },
    { id: '11', fired: false, first: false, detail: '' },
    { id: '12', fired: false, first: false, detail: '' },
  ]),
  { first: false, any: false }
)

// Case 6: 款二 fired only → first=false, any=true (款二 has first:false in engine)
check(
  '款二 fired only',
  summarize([
    { id: '1①', fired: false, first: false, detail: '' },
    { id: '1②', fired: false, first: false, detail: '' },
    { id: '2',  fired: true,  first: false, detail: '' },
    { id: '3',  fired: false, first: false, detail: '' },
    { id: '6',  fired: false, first: false, detail: '' },
    { id: '11', fired: false, first: false, detail: '' },
    { id: '12', fired: false, first: false, detail: '' },
  ]),
  { first: false, any: true }
)

console.log(pass ? '\n✅ All checks passed' : '\n❌ Some checks FAILED')
process.exit(pass ? 0 : 1)
