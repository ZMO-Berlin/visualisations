/** Include all layout/encoding inputs, even when node and edge counts match. */
export function graphSignature(nodes, links, totalAuthors) {
    const id = end => typeof end === 'object' ? end.id : end;
    return JSON.stringify([
        nodes.map(node => [node.id, node.count]),
        links.map(link => [id(link.source), id(link.target), link.weight]).sort(),
        totalAuthors
    ]);
}
