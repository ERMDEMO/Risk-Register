"""Changes applied to the register page for the GitHub app and demo."""
TABS_OLD = "['sources', 'Sources'], "
TITLE_OLD = "Emerging Risk Register"
TITLE_NEW = "Horizon Scanner"


def tweak(page):
    assert page.count(TABS_OLD) == 1, "tab list changed"
    page = page.replace(TABS_OLD, "")                      # hide the Sources tab
    page = page.replace("<title>" + TITLE_OLD + "</title>", "<title>" + TITLE_NEW + "</title>", 1)
    page = page.replace("<h1>" + TITLE_OLD + "</h1>", "<h1>" + TITLE_NEW + "</h1>", 1)
    return page
