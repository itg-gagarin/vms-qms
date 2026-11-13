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
    page.click("button:has-text('Sign in')")
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
        page.goto(f"{BASE}/ncf/new?q=MR-2026-10-0001")
        page.click("button:has-text('Create NCF')")
        page.wait_for_url(re.compile(r"/ncf/\d+/edit"))
        ncf_url = page.url.replace("/edit", "")
        no = page.locator("text=/No\\. \\d+\\/[IVX]+\\/2026/").first.inner_text()
        print("created", no, ncf_url)

        # items: a defect above sample must be refused on screen
        page.select_option("#line_id", index=0)
        page.fill("#qty_sample", "32")
        page.fill("#qty_defect", "40")
        page.click("button:has-text('Tambah barang')")
        expect(page.locator("p[role=alert]")).to_contain_text("Jumlah Cacat")
        page.fill("#qty_defect", "32")
        page.fill("#qty_return", "100")
        page.click("button:has-text('Tambah barang')")
        expect(page.locator("table").first).to_contain_text("RP.001.0008.0005.00419")
        page.select_option("#line_id", index=0)
        page.fill("#qty_sample", "20")
        page.fill("#qty_defect", "20")
        page.fill("#qty_return", "65")
        page.click("button:has-text('Tambah barang')")
        expect(page.locator("table").first).to_contain_text("RP.001.0008.0005.00506")

        page.check("input[name=goods_status][value=FAILED]")
        page.select_option("#problem_category_id", label="Printing / finishing")
        page.fill("#problem_desc", "Printing jelek di bagian belakang box.")
        page.fill("#follow_up", "Retur. Barang 1: 100. Barang 2: 65.")
        page.click("button:has-text('Save sections C, D and F')")
        expect(page.get_by_text("Saved.")).to_be_visible()

        page.set_input_files("#files", PNG)
        page.fill("#note", "Foto sisi belakang box")
        page.click("button:has-text('Upload')")
        expect(page.get_by_text("Evidence added.")).to_be_visible()
        shot(page, "02-edit-complete")

        page.fill("#password", "wrong")
        page.click("button:has-text('Sign and submit')")
        expect(page.locator("p[role=alert]")).to_contain_text("Password")
        page.fill("#password", PW)
        page.click("button:has-text('Sign and submit')")
        page.wait_for_url(ncf_url)
        expect(page.get_by_text("Waiting approval").first).to_be_visible()

        # 2. Three approvers sign in order
        for who in ["qcm", "whs", "gm"]:
            login(page, who)
            page.goto(f"{BASE}/ncf?tab=approve")
            page.click(f"a:has-text('{no.replace('No. ', '')}')")
            page.fill("#pw", PW)
            page.click("button:has-text('Setujui')")
            expect(page.get_by_text(re.compile(r"^Approved and signed\. "))).to_be_visible()
        shot(page, "03-approved-gm")

        # 3. Purchasing generates the link
        login(page, "pur")
        page.goto(f"{BASE}/ncf?tab=send")
        page.click(f"a:has-text('{no.replace('No. ', '')}')")
        page.click("button:has-text('Generate link')")
        link = page.get_by_label("Supplier link").input_value()
        print("supplier link", link)
        shot(page, "04-link-generated")

        # 4. Supplier answers without an account
        sup = browser.new_context(viewport={"width": 390, "height": 844}).new_page()
        sup.goto(link)
        expect(sup.get_by_text("Corrective dan preventive dari supplier")).to_be_visible()
        shot(sup, "05-supplier-phone")
        sup.fill("#root_cause", "Tinta printer habis pada shift malam, QC akhir tidak memeriksa sisi belakang.")
        sup.fill("#corrective_action", "Cetak ulang 165 box dan kirim pengganti.")
        sup.fill("#target_date", "2026-12-15")
        sup.fill("#preventive_action", "Checklist QC akhir menambah pemeriksaan sisi belakang.")
        sup.fill("#effective_from", "2026-12-01")
        sup.fill("#responder_name", "Hendra")
        sup.fill("#responder_position", "QA Manager")
        sup.fill("#responder_email", "hendra@premier.demo")
        sup.check("input[name=confirm]")
        sup.click("button:has-text('Kirim respons')")
        expect(sup.get_by_text("Respons Anda sudah kami terima")).to_be_visible()
        shot(sup, "05b-supplier-answered")
        sup.reload()
        expect(sup.get_by_text("Hendra").first).to_be_visible()

        # 5. Purchasing verifies and closes
        page.goto(ncf_url)
        page.fill("#close-note", "CAPA diterima. Box pengganti dicek saat datang.")
        page.click("button:has-text('Close NCF')")
        expect(page.get_by_text("NCF closed.")).to_be_visible()
        page.reload()
        shot(page, "06-closed-detail")

        # 5b. The emailed-reply path: PO first, link, reply marked returned, CAPA checked, closed
        login(page, "qc")
        page.goto(f"{BASE}/ncf/new?q=MR-2026-11-0009")
        po_value = page.locator("select[name=po_id] option", has_text="4500012367").get_attribute("value")
        page.select_option("select[name=po_id]", value=po_value)
        page.click("button:has-text('Create NCF')")
        page.wait_for_url(re.compile(r"/ncf/\d+/edit"))
        url2 = page.url.replace("/edit", "")
        no2 = page.locator("text=/No\\. \\d+\\/[IVX]+\\/2026/").first.inner_text().replace("No. ", "")
        assert page.locator("#line_id option").count() == 1, "only the chosen PO's line is offered"
        page.select_option("#line_id", index=0)
        page.fill("#qty_sample", "10")
        page.fill("#qty_defect", "3")
        page.fill("#qty_return", "3")
        page.click("button:has-text('Tambah barang')")
        page.check("input[name=goods_status][value=FAILED]")
        page.select_option("#problem_category_id", label="Damaged")
        page.fill("#problem_desc", "Box penyok di sudut, 3 dari 10 sample.")
        page.fill("#follow_up", "Retur 3 pcs.")
        page.click("button:has-text('Save sections C, D and F')")
        expect(page.get_by_text("Saved.")).to_be_visible()
        page.set_input_files("#files", PNG)
        page.click("button:has-text('Upload')")
        expect(page.get_by_text("Evidence added.")).to_be_visible()
        page.fill("#password", PW)
        page.click("button:has-text('Sign and submit')")
        page.wait_for_url(url2)
        for who in ["qcm", "whs", "gm"]:
            login(page, who)
            page.goto(url2)
            page.fill("#pw", PW)
            page.click("button:has-text('Setujui')")
            expect(page.get_by_text(re.compile(r"^Approved and signed\. "))).to_be_visible()
        login(page, "pur")
        page.goto(url2)
        page.click("button:has-text('Generate link')")
        expect(page.get_by_label("Supplier link")).to_be_visible()
        page.goto(f"{BASE}/outbox?tab=waiting")
        expect(page.get_by_text(no2)).to_be_visible()
        shot(page, "06b-supplier-outbox")
        page.get_by_text(no2).locator("xpath=ancestor::tr").locator("td").nth(3).click()  # a click anywhere on the row opens it
        page.wait_for_url(url2)
        reply = os.path.join(OUT, "_reply.txt")
        with open(reply, "w") as f:
            f.write("Akar masalah: palet tidak dibungkus. Perbaikan: kirim pengganti 3 pcs.")
        page.set_input_files("#files", reply)
        page.click("button:has-text('Mark returned')")
        expect(page.get_by_text("Reply recorded and the clock stopped")).to_be_visible()
        shot(page, "06c-check-capa")
        page.fill("#root_cause", "Palet tidak dibungkus stretch film.")
        page.fill("#corrective_action", "Kirim pengganti 3 pcs.")
        page.fill("#target_date", "2026-12-20")
        page.fill("#preventive_action", "Semua palet dibungkus stretch film.")
        page.fill("#effective_from", "2026-12-01")
        page.fill("#responder_name", "Rina")
        page.fill("#responder_position", "QC Supervisor")
        page.click("button:has-text('Confirm CAPA')")
        expect(page.get_by_text("CAPA confirmed")).to_be_visible()
        page.reload()
        page.fill("#close-note", "CAPA dicek dengan email balasan supplier.")
        page.click("button:has-text('Close NCF')")
        expect(page.get_by_text("NCF closed.")).to_be_visible()

        # 6. Print and QR verification
        page.goto(ncf_url.replace("/ncf/", "/print/"))
        expect(page.get_by_text("NON CONFORMITY FORM").first).to_be_visible()
        shot(page, "07-print")
        svg_count = page.locator("[role=img] svg").count()
        print("QR codes on print:", svg_count)
        assert svg_count == 2 + 4, "1 document QR per page and 4 signature QRs expected"

        doc_href = page.locator("a[aria-label='QR verifikasi dokumen']").first.get_attribute("href")
        sig_hrefs = [a.get_attribute("href") for a in page.locator("a[aria-label^='QR tanda tangan']").all()]

        # 7. Anyone with the paper sees the summary; evidence needs login
        anon = browser.new_context().new_page()
        anon.goto(doc_href)
        expect(anon.get_by_text("This is the current version")).to_be_visible()
        expect(anon.get_by_text("open only for auditors")).to_be_visible()
        shot(anon, "08-verify-public")
        anon.goto(sig_hrefs[-1])
        expect(anon.get_by_text("Lina Wijaya").first).to_be_visible()
        shot(anon, "09-verify-signature")

        # 8. Auditor opens the full record from the QR
        login(page, "audit")
        page.goto(doc_href)
        page.click("text=Open full record with evidence")
        expect(page.get_by_text("Closed").first).to_be_visible()

        # 9. Real SAP data: an MRReg from the export, with 2 POs
        login(page, "qc")
        page.goto(f"{BASE}/ncf/new?q=260014728")
        if page.get_by_role("button", name="Create NCF").count():
            page.click("button:has-text('Create NCF')")
            page.wait_for_url(re.compile(r"/ncf/\d+/edit"))
            opts = page.locator("#line_id option").all_inner_texts()
            print("real MRReg lines:", len(opts), opts[:2])
            shot(page, "10-real-mrreg-edit")

        # 10. Settings and outbox
        login(page, "admin")
        page.goto(f"{BASE}/settings")
        shot(page, "11-settings")
        page.goto(f"{BASE}/outbox")
        expect(page.get_by_role("heading", name="Supplier Outbox")).to_be_visible()

        print("page errors:", errors)
        assert not errors, errors
        print("E2E OK")
        browser.close()


if __name__ == "__main__":
    main()
