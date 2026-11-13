"""Browser test of the whole NCF flow, as each role would click it.
Run with the app on http://localhost:3000 and seeded data:  python3 tests/e2e_browser.py
Screenshots go to tests/screens/.
"""
import os
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("APP_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(__file__), "screens")
os.makedirs(OUT, exist_ok=True)
PW = "demo1234"
PNG = os.path.join(OUT, "_evidence.png")
with open(PNG, "wb") as f:
    import base64
    f.write(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"{name}.png"), full_page=True)


def login(page, who):
    page.context.clear_cookies()
    page.goto(f"{BASE}/login")
    page.fill("#email", f"{who}@demo.local")
    page.fill("#password", PW)
    page.click("button:visible:has-text('Sign in')")
    page.wait_for_url(re.compile(r"/ncf"))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # 1. QC creates the NCF from the MRReg
        login(page, "qc")
        shot(page, "01-worklist-qc")
        page.goto(f"{BASE}/ncf/new?q=260012841")
        page.click("button:visible:has-text('Create NCF')")
        page.wait_for_url(re.compile(r"/ncf/\d+/edit"))
        ncf_url = page.url.replace("/edit", "")
        no = page.locator("text=/No\\. \\d+\\/[IVX]+\\/2026/").first.inner_text()
        print("created", no, ncf_url)

        # items: a defect above sample must be refused on screen
        page.select_option("#line_id", index=0)
        page.fill("#qty_sample", "32")
        page.fill("#qty_defect", "40")
        page.click("button:visible:has-text('Tambah barang')")
        expect(page.locator("p[role=alert]")).to_contain_text("Jumlah Cacat")
        page.fill("#qty_defect", "32")
        page.fill("#qty_return", "100")
        page.click("button:visible:has-text('Tambah barang')")
        expect(page.locator("table").first).to_contain_text("RP.001.0008.0005.00419")
        page.select_option("#line_id", index=0)
        page.fill("#qty_sample", "20")
        page.fill("#qty_defect", "20")
        page.fill("#qty_return", "65")
        page.click("button:visible:has-text('Tambah barang')")
        expect(page.locator("table").first).to_contain_text("RP.001.0008.0005.00506")

        page.check("input[name=goods_status][value=FAILED]")
        page.select_option("#problem_category_id", label="Printing / finishing")
        page.fill("#problem_desc", "Printing jelek di bagian belakang box.")
        page.fill("#follow_up", "Retur. Barang 1: 100. Barang 2: 65.")
        page.click("button:visible:has-text('Save sections C, D and F')")
        expect(page.get_by_text("Saved.")).to_be_visible()

        page.set_input_files("#files", PNG)
        page.fill("#note", "Foto sisi belakang box")
        page.click("button:visible:has-text('Upload')")
        expect(page.get_by_text("Evidence added.")).to_be_visible()
        shot(page, "02-edit-complete")

        page.fill("#password", "wrong")
        page.click("button:visible:has-text('Sign and submit')")
        expect(page.locator("p[role=alert]")).to_contain_text("Password")
        page.fill("#password", PW)
        page.click("button:visible:has-text('Sign and submit')")
        page.wait_for_url(ncf_url)
        expect(page.get_by_text("Waiting approval").first).to_be_visible()

        # 2. Three approvers sign in order
        for who in ["qcm", "whs", "gm"]:
            login(page, who)
            page.goto(f"{BASE}/ncf?tab=approve")
            page.click(f"a:visible:has-text('{no.replace('No. ', '')}')")
            page.fill("#pw", PW)
            page.click("button:visible:has-text('Setujui')")
            expect(page.get_by_text(re.compile(r"^Approved and signed\. "))).to_be_visible()
        shot(page, "03-approved-gm")

        # 3. Purchasing exports the form, emails it themselves, marks it sent (no link leaves the system)
        login(page, "pur")
        page.goto(f"{BASE}/ncf?tab=send")
        page.click(f"a:visible:has-text('{no.replace('No. ', '')}')")
        expect(page.get_by_role("link", name="Export form (PDF)")).to_be_visible()
        page.click("button:visible:has-text('Mark as sent')")
        expect(page.get_by_text("Marked as sent")).to_be_visible()
        shot(page, "04-marked-sent")

        # 4. The supplier's reply arrives by email: Purchasing attaches it and marks it returned
        reply = os.path.join(OUT, "_reply.txt")
        with open(reply, "w") as f:
            f.write("Akar masalah: tinta habis. Perbaikan: cetak ulang 165 box.")
        page.set_input_files("#files", reply)
        page.fill("#note", "Balasan Hendra (QA Manager)")
        page.click("button:visible:has-text('Mark returned')")
        expect(page.get_by_text("Supplier's reply recorded")).to_be_visible()
        shot(page, "05-returned")

        # 5. Purchasing verifies and closes
        page.goto(ncf_url)
        page.click("button:visible:has-text('Close NCF')")
        expect(page.get_by_text("NCF closed.")).to_be_visible()
        page.reload()
        shot(page, "06-closed-detail")

        # 5b. An MRReg with two POs: the PO is chosen in the draft
        login(page, "qc")
        page.goto(f"{BASE}/ncf/new?q=260014390")
        page.click("button:visible:has-text('Create NCF')")
        page.wait_for_url(re.compile(r"/ncf/\d+/edit"))
        url2 = page.url.replace("/edit", "")
        no2 = page.locator("text=/No\\. \\d+\\/[IVX]+\\/2026/").first.inner_text().replace("No. ", "")
        expect(page.get_by_text("Choose the PO in section A")).to_be_visible()
        po_value = page.locator("#po_id option", has_text="260010390").get_attribute("value")
        page.select_option("#po_id", value=po_value)
        page.click("button:visible:has-text('Set PO')")
        expect(page.get_by_text("PO set.")).to_be_visible()
        assert page.locator("#line_id option").count() == 1, "only the chosen PO's line is offered"
        page.select_option("#line_id", index=0)
        page.fill("#qty_sample", "10")
        page.fill("#qty_defect", "3")
        page.fill("#qty_return", "3")
        page.click("button:visible:has-text('Tambah barang')")
        # Submitting too early outlines the cards still to fill (C, D, E, F) and scrolls to the first
        page.fill("#password", PW)
        page.click("button:visible:has-text('Sign and submit')")
        page.wait_for_url(re.compile(r"/edit\?check=1"))
        flagged = page.locator("[data-missing=flag]").evaluate_all("els => els.map(e => e.id)")
        assert flagged == ["part-C", "part-D", "part-F", "part-E"], flagged
        expect(page.locator("#part-C").get_by_text("Fill in before submitting")).to_be_visible()
        shot(page, "05a-incomplete-highlight")
        page.check("input[name=goods_status][value=FAILED]")
        page.select_option("#problem_category_id", label="Damaged")
        page.fill("#problem_desc", "Box penyok di sudut, 3 dari 10 sample.")
        page.fill("#follow_up", "Retur 3 pcs.")
        page.click("button:visible:has-text('Save sections C, D and F')")
        expect(page.get_by_text("Saved.")).to_be_visible()
        page.set_input_files("#files", PNG)
        page.click("button:visible:has-text('Upload')")
        expect(page.get_by_text("Evidence added.")).to_be_visible()
        shot(page, "05b-draft-po")
        page.fill("#password", PW)
        page.click("button:visible:has-text('Sign and submit')")
        page.wait_for_url(url2)
        for who in ["qcm", "whs", "gm"]:
            login(page, who)
            page.goto(url2)
            page.fill("#pw", PW)
            page.click("button:visible:has-text('Setujui')")
            expect(page.get_by_text(re.compile(r"^Approved and signed\. "))).to_be_visible()
        login(page, "pur")
        page.goto(url2)
        page.click("button:visible:has-text('Mark as sent')")
        expect(page.get_by_text("Marked as sent")).to_be_visible()
        page.goto(f"{BASE}/outbox?tab=waiting")
        expect(page.get_by_text(no2).locator("visible=true").first).to_be_visible()
        shot(page, "06b-supplier-outbox")
        page.locator("tr", has_text=no2).locator("td").nth(3).click()  # a click anywhere on the row opens it
        page.wait_for_url(url2)

        # 6. Print and QR verification
        page.goto(ncf_url.replace("/ncf/", "/print/"))
        expect(page.get_by_text("NON CONFORMITY FORM").first).to_be_visible()
        shot(page, "07-print")
        svg_count = page.locator("[role=img] svg").count()
        print("QR codes on print:", svg_count)
        assert svg_count == 2 + 4, "1 document QR per page and 4 signature QRs expected"

        doc_href = page.locator("a[aria-label='QR verifikasi dokumen']").first.get_attribute("href")

        # The supplier's copy carries the same live QR codes, so the supplier can check it is genuine
        page.goto(ncf_url.replace("/ncf/", "/print/") + "?export=1")
        expect(page.get_by_text("Salinan untuk supplier").first).to_be_visible()
        assert page.locator("[role=img] svg").count() == 2 + 4, "supplier copy keeps the document and signature QRs"
        assert page.locator("a[aria-label='QR verifikasi dokumen']").first.get_attribute("href") == doc_href
        assert page.get_by_text("Hasil verifikasi").count() == 0, "no verification note on the form"
        shot(page, "07b-supplier-copy")
        page.goto(ncf_url.replace("/ncf/", "/print/"))
        sig_hrefs = [a.get_attribute("href") for a in page.locator("a[aria-label^='QR tanda tangan']").all()]

        # 7. Anyone with the paper sees the summary; evidence needs login
        anon = browser.new_context().new_page()
        anon.goto(doc_href)
        expect(anon.get_by_text("Dokumen asli.")).to_be_visible()
        for private in ["hash", "Versi", "version", "password", "Responded", "Closed"]:
            assert anon.get_by_text(private).count() == 0, f"public page shows {private}"
        shot(anon, "08-verify-public")
        anon.goto(sig_hrefs[-1])
        expect(anon.get_by_text("Lina Wijaya").first).to_be_visible()
        for private in ["hash", "Method", "password", "version"]:
            assert anon.get_by_text(private).count() == 0, f"signature page shows {private}"
        shot(anon, "09-verify-signature")

        # 8. Auditor opens the full record from the QR
        login(page, "audit")
        page.goto(doc_href)
        page.click("text=buka rekaman lengkap")
        expect(page.get_by_text("Closed").first).to_be_visible()

        # 9. Real SAP data: an MRReg from the export, with 2 POs
        login(page, "qc")
        page.goto(f"{BASE}/ncf/new?q=260014728")
        if page.get_by_role("button", name="Create NCF").count():
            page.click("button:visible:has-text('Create NCF')")
            page.wait_for_url(re.compile(r"/ncf/\d+/edit"))
            opts = page.locator("#line_id option").all_inner_texts()
            print("real MRReg lines:", len(opts), opts[:2])
            shot(page, "10-real-mrreg-edit")

        # 10. Settings and outbox
        login(page, "admin")
        page.goto(f"{BASE}/settings")
        shot(page, "11-settings")
        login(page, "pur")
        page.goto(f"{BASE}/outbox")
        expect(page.get_by_role("heading", name="Supplier Outbox")).to_be_visible()
        assert page.get_by_text("System email queue").count() == 0

        print("page errors:", errors)
        assert not errors, errors
        print("E2E OK")
        browser.close()


if __name__ == "__main__":
    main()
