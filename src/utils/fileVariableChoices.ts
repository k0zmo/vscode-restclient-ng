import { EventEmitter, TextDocument, window } from 'vscode';
import { CommentIdentifiersRegex, FileVariableChoiceRegex, FileVariableDefinitionRegex, VariableReferenceRegex } from '../common/constants';
import { DocumentCache } from '../models/documentCache';

interface Choice {
    label: string;
    description: string;
}

interface ChoiceGroup {
    line: number;
    options: Choice[];
}

export class FileVariableChoices {
    private static readonly definitions = new DocumentCache<Map<string, ChoiceGroup>>();
    private static readonly selections = new DocumentCache<Map<string, Choice>>(true);
    private static readonly selectionChanged = new EventEmitter<void>();
    public static readonly onDidChangeSelection = FileVariableChoices.selectionChanged.event;

    public static getDefinitions(document: TextDocument): Map<string, ChoiceGroup> {
        const cached = this.definitions.get(document);
        if (cached) {
            return cached;
        }

        const groups = new Map<string, ChoiceGroup>();
        if (document.languageId === 'http') {
            for (let line = 0; line < document.lineCount; line++) {
                const text = document.lineAt(line).text;
                if (text.trim() && !CommentIdentifiersRegex.test(text) && !FileVariableDefinitionRegex.test(text)) {
                    break;
                }

                const match = text.match(FileVariableChoiceRegex);
                if (match && match[2].trim()) {
                    const [, name, label, value] = match;
                    const group = groups.get(name) ?? { line, options: [] };
                    group.options.push({ label: label.trim(), description: value });
                    groups.set(name, group);
                }
            }
        }
        this.definitions.set(document, groups);
        return groups;
    }

    public static getSelection(document: TextDocument, name: string): Choice | undefined {
        const selection = this.selections.get(document)?.get(name);
        return selection && this.findChoice(document, name, selection);
    }

    public static async pick(document: TextDocument, name: string): Promise<Choice | undefined> {
        const group = this.getDefinitions(document).get(name);
        if (!group) {
            return undefined;
        }
        const picked = await window.showQuickPick(group.options, { placeHolder: `Select a value for ${name}` });
        const selection = picked && this.findChoice(document, name, picked);
        if (selection) {
            const selections = this.selections.get(document) ?? new Map<string, Choice>();
            selections.set(name, selection);
            this.selections.set(document, selections);
            this.selectionChanged.fire();
        }
        return selection;
    }

    public static async resolveRequest(document: TextDocument, request: string, variables: Map<string, string>): Promise<boolean> {
        const groups = this.getDefinitions(document);
        if (groups.size === 0) {
            return true;
        }
        for (const [, reference] of request.matchAll(VariableReferenceRegex)) {
            const name = reference.trim();
            if (groups.has(name) && !variables.has(name)) {
                const selection = this.getSelection(document, name) ?? await this.pick(document, name);
                if (!selection) {
                    return false;
                }
                variables.set(name, selection.description);
            }
        }
        return true;
    }

    private static findChoice(document: TextDocument, name: string, choice: Choice): Choice | undefined {
        return this.getDefinitions(document).get(name)?.options.find(
            option => option.label === choice.label && option.description === choice.description);
    }
}
