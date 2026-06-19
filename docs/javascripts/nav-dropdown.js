document$.subscribe(function () {

  // Clean up any dropdowns injected by a previous navigation cycle.
  document.querySelectorAll('.md-tabs__dropdown').forEach(el => el.remove());
  document.querySelectorAll('.md-tabs__item--has-dropdown').forEach(el => {
    el.classList.remove('md-tabs__item--has-dropdown');
  });

  const tabItems = document.querySelectorAll('.md-tabs__item');

  tabItems.forEach(tabItem => {
    const tabLink = tabItem.querySelector('.md-tabs__link');
    if (!tabLink) return;
    const tabText = tabLink.textContent.trim();

    const navSections = document.querySelectorAll(
      '.md-nav--primary > .md-nav__list > .md-nav__item--nested'
    );

    navSections.forEach(section => {
      const ellipsis = section.querySelector(':scope > label > .md-ellipsis');
      if (!ellipsis || ellipsis.textContent.trim() !== tabText) return;

      const children = section.querySelectorAll(
        ':scope > nav > ul > li.md-nav__item'
      );
      if (!children.length) return;

      // Only build a dropdown when the section has nested sub-sections.
      const hasSubSections = [...children].some(c =>
        c.classList.contains('md-nav__item--nested')
      );
      if (!hasSubSections) return;

      const dropdown = document.createElement('ul');
      dropdown.className = 'md-tabs__dropdown';

      children.forEach(child => {
        const isNested = child.classList.contains('md-nav__item--nested');
        const a = document.createElement('a');

        if (isNested) {
          const label = child.querySelector(':scope > label > .md-ellipsis');
          // Point to the first link of the sub-section (index page).
          const firstLink = child.querySelector('a.md-nav__link');
          if (!label || !firstLink) return;
          a.textContent = label.textContent.trim();
          a.href = firstLink.href;
        } else {
          const link = child.querySelector(':scope > a.md-nav__link');
          if (!link) return;
          a.textContent = link.textContent.trim();
          a.href = link.href;
        }

        if (a.textContent) {
          const li = document.createElement('li');
          li.appendChild(a);
          dropdown.appendChild(li);
        }
      });

      if (dropdown.children.length) {
        tabItem.classList.add('md-tabs__item--has-dropdown');
        tabItem.appendChild(dropdown);
      }
    });
  });
});
