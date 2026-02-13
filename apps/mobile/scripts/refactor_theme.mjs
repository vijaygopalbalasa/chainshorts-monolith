import fs from 'fs';
import path from 'path';

const dirs = [
    '/Users/vijaygopalb/InshortsWeb3/apps/mobile/src/screens',
    '/Users/vijaygopalb/InshortsWeb3/apps/mobile/src/components'
];

for (const dir of dirs) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));
    for (const file of files) {
        const filePath = path.join(dir, file);
        let content = fs.readFileSync(filePath, 'utf8');

        if (!content.includes('palette') || content.includes('useTheme()')) continue;

        // Add useTheme if needed
        if (!content.includes('useTheme')) {
            content = content.replace(/import\s+\{([^}]+)\}\s+from\s+"(\.\.\/)*theme";/, (match, group, prefix) => {
                if (!group.includes('useTheme')) {
                    return `import { ${group}, useTheme } from "${prefix || '../'}theme";`;
                }
                return match;
            });
        }

        // Ensure useMemo is imported
        if (!content.includes('useMemo')) {
            content = content.replace(/import\s+\{([^}]+)\}\s+from\s+"react";/, (match, group) => {
                return `import { ${group}, useMemo } from "react";`;
            });
        }

        // Change const styles = StyleSheet.create({
        content = content.replace(/const\s+styles\s*=\s*StyleSheet\.create\(\{/g, 'const getStyles = (palette: any) => StyleSheet.create({');

        // Inject into function components
        const injectHook = '\n  const { palette } = useTheme();\n  const styles = useMemo(() => getStyles(palette), [palette]);\n';

        // For export function Name()
        content = content.replace(/(export\s+function\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{)/g, `$1${injectHook}`);

        // For export const Name = function()
        content = content.replace(/(export\s+const\s+[A-Za-z0-9_]+\s*=\s*function\s*[A-Za-z0-9_]*\s*\([^)]*\)\s*\{)/g, `$1${injectHook}`);

        // For export const Name = memo(function Name()
        content = content.replace(/(export\s+const\s+[A-Za-z0-9_]+\s*=\s*memo\(\s*function\s+[A-Za-z0-9_]*\s*\([^)]*\)\s*\{)/g, `$1${injectHook}`);

        // For export const Name = () => {
        content = content.replace(/(export\s+const\s+[A-Za-z0-9_]+\s*=\s*\([^)]*\)\s*=>\s*\{)/g, `$1${injectHook}`);

        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Refactored ${file}`);
    }
}
