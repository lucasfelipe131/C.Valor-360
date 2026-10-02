// Fixed SQL identifiers supplied only by repository code, never by a request.
export const realBusinessClient=(alias='c')=>`COALESCE(${alias}.source,'') <> 'k5_synthetic_fixture'`
export const realBusinessRecord=(alias)=>`NOT EXISTS (SELECT 1 FROM clients k5_fixture WHERE k5_fixture.tenant_id=${alias}.tenant_id AND k5_fixture.id=${alias}.client_id AND k5_fixture.source='k5_synthetic_fixture')`
export const realBusinessFeedback=(alias)=>`NOT EXISTS (SELECT 1 FROM val_recommendations k5_recommendation JOIN clients k5_fixture ON k5_fixture.tenant_id=k5_recommendation.tenant_id AND k5_fixture.id=k5_recommendation.client_id WHERE k5_recommendation.tenant_id=${alias}.tenant_id AND k5_recommendation.id=${alias}.recommendation_id AND k5_fixture.source='k5_synthetic_fixture')`
