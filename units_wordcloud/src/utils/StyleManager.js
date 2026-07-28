/**
 * Inline styles for the word cloud's own DOM.
 *
 * These elements are created at runtime and sized relative to their parent, so
 * their layout is set here rather than in a stylesheet. Everything with a
 * stable class name is styled in `src/styles/` instead.
 */
export class StyleManager {
    static setupContainer(container) {
        Object.assign(container.style, {
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden'
        });
    }

    static setupWrapper(wrapper) {
        Object.assign(wrapper.style, {
            width: '100%',
            height: '100%',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden'
        });
    }

    static setupSVG(svg) {
        svg
            .style('width', '100%')
            .style('height', '100%')
            .style('display', 'block')
            .style('background', 'transparent')
            .style('overflow', 'visible')
            .attr('preserveAspectRatio', 'xMidYMid meet');
    }
}
