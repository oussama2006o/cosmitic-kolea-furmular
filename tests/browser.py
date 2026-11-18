"""Run against an empty, disposable local instance with Python Playwright."""
import os

from playwright.sync_api import expect, sync_playwright


def check_survey(browser, url):
    page = browser.new_page(viewport={"width": 360, "height": 800}, locale="ar-DZ")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="networkidle")
    expect(page.get_by_role("group")).to_have_count(4)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.keyboard.press("Tab")
    expect(page.get_by_role("link", name="انتقلي إلى الأسئلة")).to_be_focused()
    page.keyboard.press("Enter")
    submit = page.get_by_role("button", name="إرسال الإجابات")
    submit.click()
    expect(page.locator("#products-error")).to_be_visible()
    products = page.locator("#products").get_by_role("checkbox")
    expect(products.first).to_be_focused()
    for index in range(3):
        products.nth(index).check()
    expect(products.nth(3)).to_be_disabled()
    products.nth(0).uncheck()
    page.get_by_label("أخرى", exact=True).check()
    submit.click()
    expect(page.locator("#other-error")).to_be_visible()
    page.get_by_label("ما المنتج الآخر؟").fill("فرشاة")
    current = page.locator("#current")
    current.get_by_label("الماركة الأولى").fill("ماركة A")
    current.get_by_label("لا أشتري حاليًا", exact=True).check()
    expect(current.get_by_label("الماركة الأولى")).to_be_disabled()
    current.get_by_label("لا أشتري حاليًا", exact=True).uncheck()
    expect(current.get_by_label("الماركة الأولى")).to_have_value("ماركة A")
    page.get_by_label("ليس لدي تفضيل", exact=True).check()
    for field in page.locator("#wanted").get_by_role("textbox").all():
        expect(field).to_be_disabled()
    page.get_by_label("لم أشترِ شيئًا", exact=True).check()

    def lose_confirmation(route):
        saved = route.fetch()
        assert saved.status == 201
        route.abort()

    page.route("**/api/responses", lose_confirmation, times=1)
    submit.click()
    expect(page.get_by_role("status").filter(has_text="تعذّر تأكيد الحفظ")).to_be_visible()
    expect(current.get_by_label("الماركة الأولى")).to_have_value("ماركة A")
    with page.expect_response("**/api/responses") as retry:
        submit.click()
    assert retry.value.status == 200
    expect(page.get_by_role("heading", name="شكرًا لمشاركتك!")).to_be_visible()
    assert not errors, errors
    page.close()

    desktop = browser.new_page(viewport={"width": 1280, "height": 900})
    desktop.goto(url, wait_until="networkidle")
    expect(desktop.locator("html")).to_have_attribute("dir", "rtl")
    screenshot = os.environ.get("SURVEY_SCREENSHOT")
    if screenshot:
        desktop.screenshot(path=screenshot)
    desktop.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        executable = os.environ.get("CHROME_PATH")
        browser = playwright.chromium.launch(executable_path=executable, headless=True)
        check_survey(browser, os.environ["SURVEY_TEST_URL"])
        browser.close()
        print("Passed mobile RTL, keyboard, validation, saved-response retry and desktop checks.")
