"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreDiscoverabilityScenario = scoreDiscoverabilityScenario;
exports.aggregateDiscoverabilityScores = aggregateDiscoverabilityScores;
const ACTION_EQUIVALENTS = {
    'filesystem.read': ['filesystem.read', 'filesystem.read_file_chunk', 'filesystem.answer_from_cache'],
    'filesystem.search_file_cache': ['filesystem.search_file_cache', 'filesystem.search'],
    'chat.read_last': ['chat.read_last', 'chat.search', 'chat.read_window', 'chat.read_message', 'chat.recall'],
};
function unique(values) {
    return Array.from(new Set(values));
}
function normalizeAction(action) {
    return action.trim().toLowerCase();
}
function equivalentActions(action) {
    const normalized = normalizeAction(action);
    return ACTION_EQUIVALENTS[normalized] || [normalized];
}
function actionSetForScenario(scenario) {
    return new Set(unique([
        ...scenario.minimumDiscoveryActions,
        ...(scenario.acceptableAlternativeActions || []),
    ]).map(normalizeAction));
}
function toolActionsBeforeFirstQuestion(trace) {
    const actions = [];
    for (const step of trace) {
        if (step.type === 'ask_user')
            break;
        if (step.type === 'tool_call' || step.type === 'observation')
            actions.push(step.action);
    }
    return actions;
}
function findAnswer(trace) {
    for (let index = trace.length - 1; index >= 0; index -= 1) {
        const step = trace[index];
        if (step.type === 'answer')
            return step;
    }
    return null;
}
function scoreDiscoverabilityScenario(scenario, trace) {
    const expectedActions = actionSetForScenario(scenario);
    const actionsBeforeQuestion = unique(toolActionsBeforeFirstQuestion(trace).map(normalizeAction));
    const coveredDiscoveryActions = unique(actionsBeforeQuestion.flatMap((action) => {
        const directMatch = expectedActions.has(action) ? [action] : [];
        const inferredMatches = scenario.minimumDiscoveryActions
            .map(normalizeAction)
            .filter((expected) => equivalentActions(expected).includes(action));
        return [...directMatch, ...inferredMatches];
    }));
    const missingDiscoveryActions = scenario.minimumDiscoveryActions
        .map(normalizeAction)
        .filter((action) => !equivalentActions(action).some((candidate) => actionsBeforeQuestion.includes(candidate)));
    const minimumPathCoverage = scenario.minimumDiscoveryActions.length === 0
        ? 1
        : unique(coveredDiscoveryActions.filter((action) => scenario.minimumDiscoveryActions.map(normalizeAction).includes(action))).length
            / scenario.minimumDiscoveryActions.length;
    const askedUser = trace.some((step) => step.type === 'ask_user');
    const askedPrematurely = askedUser && !scenario.askRequired && missingDiscoveryActions.length > 0;
    const answer = findAnswer(trace);
    const answerCorrect = answer?.correct === true;
    const groundedInEvidence = answer?.groundedInEvidence === true;
    const correctEscalation = askedUser
        && scenario.askRequired
        && missingDiscoveryActions.length === 0
        && answerCorrect;
    const failures = [];
    if (askedPrematurely) {
        failures.push(actionsBeforeQuestion.length === 0 ? 'premature_question' : 'weak_exploration');
    }
    if (!askedUser && !scenario.askRequired && !answerCorrect && minimumPathCoverage >= 1) {
        failures.push('missed_synthesis');
    }
    if (!askedUser && !scenario.askRequired && !groundedInEvidence && !answerCorrect) {
        failures.push('wrong_confidence');
    }
    if (askedUser && actionsBeforeQuestion.length === 0) {
        failures.push('tool_avoidance');
    }
    const uniqueFailures = unique(failures);
    let classification = 'strong_pass';
    if (!answerCorrect || uniqueFailures.length > 0) {
        classification = 'fail';
    }
    else if (minimumPathCoverage < 1 || !groundedInEvidence || (askedUser && scenario.askRequired)) {
        classification = 'soft_pass';
    }
    return {
        scenarioId: scenario.id,
        askedUser,
        askedPrematurely,
        correctEscalation,
        minimumPathCoverage,
        coveredDiscoveryActions,
        missingDiscoveryActions,
        answerCorrect,
        groundedInEvidence,
        classification,
        failures: uniqueFailures,
    };
}
function aggregateDiscoverabilityScores(scores) {
    const totalScenarios = scores.length;
    const safeDivide = (value) => (totalScenarios === 0 ? 0 : value / totalScenarios);
    const failureCounts = {
        premature_question: 0,
        weak_exploration: 0,
        missed_synthesis: 0,
        wrong_confidence: 0,
        tool_avoidance: 0,
    };
    const classifications = {
        strong_pass: 0,
        soft_pass: 0,
        fail: 0,
    };
    for (const score of scores) {
        classifications[score.classification] += 1;
        for (const failure of score.failures)
            failureCounts[failure] += 1;
    }
    return {
        totalScenarios,
        unnecessaryQuestionRate: safeDivide(scores.filter((score) => score.askedPrematurely).length),
        prematureQuestionRate: safeDivide(scores.filter((score) => score.failures.includes('premature_question')).length),
        correctEscalationRate: safeDivide(scores.filter((score) => score.correctEscalation).length),
        correctAnswerRate: safeDivide(scores.filter((score) => score.answerCorrect).length),
        groundedAnswerRate: safeDivide(scores.filter((score) => score.groundedInEvidence).length),
        minimumPathCompletionRate: safeDivide(scores.filter((score) => score.minimumPathCoverage >= 1).length),
        classifications,
        failureCounts,
    };
}
//# sourceMappingURL=discoverabilityAudit.js.map