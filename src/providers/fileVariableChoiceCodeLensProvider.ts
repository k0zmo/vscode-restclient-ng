import { CodeLens, CodeLensProvider, Range, TextDocument } from 'vscode';
import { FileVariableChoices } from '../utils/fileVariableChoices';

export class FileVariableChoiceCodeLensProvider implements CodeLensProvider {
    public readonly onDidChangeCodeLenses = FileVariableChoices.onDidChangeSelection;

    public provideCodeLenses(document: TextDocument): CodeLens[] {
        const lenses: CodeLens[] = [];
        for (const [name, { line }] of FileVariableChoices.getDefinitions(document)) {
            const selection = FileVariableChoices.getSelection(document, name);
            lenses.push(new CodeLens(new Range(line, 0, line, 0), {
                title: `${name}: ${selection?.label ?? 'Select value'} ▾`,
                command: 'rest-client-ng._pickFileVariableChoice',
                arguments: [document, name],
            }));
        }
        return lenses;
    }
}
