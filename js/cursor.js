export function initTargetCursor(selector = 'button, a, [data-action], .pvp-action-btn, .entity-card, .cursor-pointer') {
    if ('ontouchstart' in window || window.matchMedia('(pointer: coarse)').matches) return;

    document.body.classList.add('custom-cursor-active');

    const wrapper = document.createElement('div');
    wrapper.className = 'target-cursor-wrapper';
    wrapper.innerHTML = `
        <div class="target-cursor-dot"></div>
        <div class="target-cursor-corner corner-tl"></div>
        <div class="target-cursor-corner corner-tr"></div>
        <div class="target-cursor-corner corner-br"></div>
        <div class="target-cursor-corner corner-bl"></div>
    `;
    document.body.appendChild(wrapper);

    const corners = [...wrapper.querySelectorAll('.target-cursor-corner')];
    const lerp = (a, b, t) => a + (b - a) * t;

    let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
    let curX = mouseX, curY = mouseY;
    let currentTarget = null;
    let spinAngle = 0;

    // Current corner offsets from cursor center
    const pos = [
        { x: -18, y: -18 },
        { x: 18, y: -18 },
        { x: 18, y: 18 },
        { x: -18, y: 18 },
    ];

    document.addEventListener('mousemove', e => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    document.addEventListener('mouseover', e => {
        currentTarget = e.target.closest(selector) || null;
    });

    document.addEventListener('mousedown', () => wrapper.classList.add('is-clicked'));
    document.addEventListener('mouseup', () => wrapper.classList.remove('is-clicked'));

    const tick = () => {
        curX = lerp(curX, mouseX, 0.12);
        curY = lerp(curY, mouseY, 0.12);
        wrapper.style.transform = `translate(${curX}px, ${curY}px)`;

        if (currentTarget && !document.contains(currentTarget)) currentTarget = null;

        spinAngle = (spinAngle + 1.2) % 360;
        const rad = spinAngle * (Math.PI / 180);
        const cos = Math.cos(rad), sin = Math.sin(rad);

        // Base square corners (fixed offsets, rotated as a rigid unit)
        const base = [
            { x: -18, y: -18 },
            { x:  18, y: -18 },
            { x:  18, y:  18 },
            { x: -18, y:  18 },
        ];

        corners.forEach((corner, i) => {
            let tx, ty;

            if (currentTarget) {
                const r = currentTarget.getBoundingClientRect();
                const p = 8;
                const targets = [
                    { x: r.left - curX - p, y: r.top - curY - p },
                    { x: r.right - curX + p, y: r.top - curY - p },
                    { x: r.right - curX + p, y: r.bottom - curY + p },
                    { x: r.left - curX - p, y: r.bottom - curY + p },
                ];
                tx = targets[i].x;
                ty = targets[i].y;
            } else {
                // Rotate the whole square as one rigid body
                tx = base[i].x * cos - base[i].y * sin;
                ty = base[i].x * sin + base[i].y * cos;
            }

            pos[i].x = lerp(pos[i].x, tx, 0.1);
            pos[i].y = lerp(pos[i].y, ty, 0.1);

            corner.style.transform = `translate(calc(${pos[i].x}px - 50%), calc(${pos[i].y}px - 50%))`;
        });

        requestAnimationFrame(tick);
    };

    tick();
}
