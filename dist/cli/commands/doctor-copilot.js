import { detectCopilotCliCompatibility } from '../../team/copilot-cli-compatibility.js';
import { colors } from '../utils/formatting.js';
export async function doctorCopilotCommand(options) {
    const report = detectCopilotCliCompatibility();
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    }
    else {
        console.log(colors.bold('GitHub Copilot CLI compatibility'));
        console.log(`  Verified contract: ${report.verifiedVersion}`);
        if (report.path) {
            console.log(`  Binary: ${report.path}`);
        }
        if (report.versionOutput) {
            console.log(`  Detected: ${report.versionOutput}`);
        }
        if (report.diagnostic) {
            console.log(`  Diagnostic: ${report.diagnostic}`);
        }
        if (report.status === 'verified') {
            console.log(`  ${colors.green('✓')} ${report.message}`);
        }
        else if (report.status === 'unverified') {
            console.log(`  ${colors.yellow('⚠')} ${report.message}`);
        }
        else {
            console.log(`  ${colors.red('✗')} ${report.message}`);
        }
        if (report.guidance) {
            console.log(`  ${report.guidance}`);
        }
    }
    return report.status === 'unsupported' || report.status === 'not-installed' ? 1 : 0;
}
//# sourceMappingURL=doctor-copilot.js.map