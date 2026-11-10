// Bird eye study, ladder view, variant B: 가격 사다리. Placeholder until the variant is built.
(() => {
  let root = null;
  BE.register({
    view: 'ladder', key: 'b', name: '가격 사다리',
    blurb: '이 시안은 제작 중입니다.',
    good: [], weak: [],
    mount(el) { root = el; },
    render() { root.replaceChildren(BE.el('div', 'panel empty', '이 시안은 제작 중입니다.')); },
  });
})();
