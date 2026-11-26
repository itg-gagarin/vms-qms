select
    h."DocEntry"                    as "MRReg Entry",
    h."DocNum"                      as "No. MRReg",
    d."LineId"                      as "MRReg Line",
    h."U_NAME"                      as "Vendor Name",
    h."U_VENDOR"                    as "Vendor Code",
    d."U_PNO"                       as "PO No.",
    d."U_INO"                       as "Item No.",
    g."ItmsGrpNam"                  as "Item Group",
    d."U_IDESC"                     as "Item Description",
    d."U_QREG"                      as "Qty Reg",
    d."U_OQREG"                     as "Open Qty Reg",
    d."U_QPO"                       as "Qty PO",
    d."U_OQPO"                      as "Open Qty PO",
    ifnull(d."U_QTYRETURN1", 0)     as "Return 1",
    h."U_Ret1Reason"                as "Return 1 Reason",
    h."U_Ret1Remarks"               as "Return 1 Remarks",
    ifnull(d."U_QTYRETURN2", 0)     as "Return 2",
    h."U_Ret2Reason"                as "Return 2 Reason",
    h."U_Ret2Remarks"               as "Return 2 Remarks",
    ifnull(d."U_QTYRETURN3", 0)     as "Return 3",
    h."U_Ret3Reason"                as "Return 3 Reason",
    h."U_Ret3Remarks"               as "Return 3 Remarks",
    ifnull(d."U_QTYRETURN1", 0)
      + ifnull(d."U_QTYRETURN2", 0)
      + ifnull(d."U_QTYRETURN3", 0) as "Total Return",
    ifnull(d."U_QREG", 0)
      - ifnull(d."U_QTYRETURN1", 0)
      - ifnull(d."U_QTYRETURN2", 0)
      - ifnull(d."U_QTYRETURN3", 0) as "Qty Accepted",
    d."U_NOTE"                      as "Note",
    h."U_STAT"                      as "Status",
    to_nvarchar(h."U_NSJLNV")       as "No Surat Jalan Vendor",
    h."CreateDate"                  as "Create Date",
    h."U_CLDATE"                    as "Close Date",
    case when h."U_CLTIME" is null then null
         else substring(lpad(to_varchar(h."U_CLTIME"), 4, '0'), 1, 2) || ':' ||
              substring(lpad(to_varchar(h."U_CLTIME"), 4, '0'), 3, 2)
    end                             as "Close Time",
    h."U_RDATE"                     as "Registration Date",
    h."U_TSJLN"                     as "Tanggal Surat Jalan",
    h."U_CFDATE"                    as "Confirm Date",
    p."DocEntry"                    as "PO Entry",
    p."DocDate"                     as "PO Date",
    p."DocStatus"                   as "PO Status",
    p."CANCELED"                    as "PO Canceled",
    p."BPLId"                       as "Branch ID",
    p."BPLName"                     as "Branch",
    pl."LineNum"                    as "PO Line Key",
    pl."VisOrder" + 1               as "PO Line No.",
    pl."ItemCode"                   as "PO Item No.",
    pl."unitMsr"                    as "UoM",
    pl."Quantity"                   as "PO Line Qty (live)",
    pl."OpenQty"                    as "PO Line Open Qty (live)",
    pl."LineStatus"                 as "PO Line Status",
    pl."ShipDate"                   as "PO Line Delivery Date",
    pl."WhsCode"                    as "Warehouse",
    pl."OcrCode"                    as "Cost Center",
    case
        when d."U_PNO" is null                          then 'NO PO ON MRREG'
        when p."DocEntry" is null                       then 'PO NOT FOUND'
        when m1."LineNum" is not null and m1."Cnt" = 1  then 'UNIQUE ITEM+QTY'
        when m1."LineNum" is not null                   then 'BY LINE ORDER - CHECK'
        when m2."LineNum" is not null                   then 'ITEM ONLY - QTY DIFFERS'
        else 'NOT MATCHED'
    end                             as "PO Line Match"
from "@ST_MRREG" h
inner join (
    select x.*,
           row_number() over (partition by x."DocEntry", x."U_PNO", x."U_INO", x."U_QPO"
                              order by x."LineId") as "Rk"
    from "@ST_MRREGD" x
) d on d."DocEntry" = h."DocEntry"
left join OITM i on i."ItemCode" = d."U_INO"
left join OITB g on g."ItmsGrpCod" = i."ItmsGrpCod"
left join OPOR p on p."DocNum" = d."U_PNO"
                and p."CardCode" = h."U_VENDOR"
left join (
    select y."DocEntry", y."LineNum", y."ItemCode", y."Quantity",
           row_number() over (partition by y."DocEntry", y."ItemCode", y."Quantity"
                              order by y."LineNum") as "Rk",
           count(*)     over (partition by y."DocEntry", y."ItemCode", y."Quantity") as "Cnt"
    from POR1 y
) m1 on m1."DocEntry" = p."DocEntry"
    and m1."ItemCode" = d."U_INO"
    and m1."Quantity" = d."U_QPO"
    and m1."Rk"       = d."Rk"
left join (
    select z."DocEntry", z."ItemCode", min(z."LineNum") as "LineNum"
    from POR1 z
    group by z."DocEntry", z."ItemCode"
    having count(*) = 1
) m2 on m2."DocEntry" = p."DocEntry"
    and m2."ItemCode" = d."U_INO"
left join POR1 pl on pl."DocEntry" = p."DocEntry"
                 and pl."LineNum"  = coalesce(m1."LineNum", m2."LineNum")
where h."U_RDATE" >= '[%0]'
  and h."U_RDATE" <= '[%1]'
  and h."U_STAT" in ('OPEN', 'CONFIRMED')
  and p."DocStatus" = 'O'
  and p."CANCELED"  = 'N'
  and pl."LineStatus" = 'O'
order by h."U_RDATE" desc, h."DocNum" desc, d."LineId" asc
