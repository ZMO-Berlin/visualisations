export function download(content, name, type = 'text/csv;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csv(rows) {
    return '\uFEFF' + rows.map(row => row.map(value => {
        let text = String(value ?? '');
        // Spreadsheet applications must not interpret source text as a formula.
        if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replaceAll('"', '""') + '"';
    }).join(',')).join('\r\n');
}

export async function copyView(button, strings) {
    try {
        await navigator.clipboard.writeText(location.href);
        button.textContent = strings.copied;
    } catch {
        const field = document.createElement('input');
        field.value = location.href;
        field.setAttribute('aria-label', strings.copyLink);
        button.after(field);
        field.focus();
        field.select();
    }
}
