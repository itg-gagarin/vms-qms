-- One MRReg can carry lines from several POs of the same supplier. QC raises an NCF against one PO,
-- chosen before the items, and only that PO's lines can be added.
alter table ncf add column po_id bigint references purchase_order;
create index ncf_po_ix on ncf (po_id);

-- Existing NCFs: take the PO of their items when all items come from one PO.
update ncf n set po_id = x.po_id
from (
  select ni.ncf_id, min(pl.po_id) as po_id
  from ncf_item ni
  join mrreg_line ml on ml.id = ni.mrreg_line_id
  join po_line pl on pl.id = ml.po_line_id
  group by ni.ncf_id
  having count(distinct pl.po_id) = 1
) x
where x.ncf_id = n.id;
