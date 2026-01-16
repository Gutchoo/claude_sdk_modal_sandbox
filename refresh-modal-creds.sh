#!/bin/bash
# Refresh Modal AWS credentials from SSO
# Run this before demos: ./refresh-modal-creds.sh

echo "Refreshing AWS credentials for Modal..."

# Check if SSO session is valid
if ! aws sts get-caller-identity --profile bedrock-claude &>/dev/null; then
    echo "SSO session expired. Logging in..."
    aws sso login --profile bedrock-claude
fi

# Export credentials
eval $(aws configure export-credentials --profile bedrock-claude --format env 2>/dev/null)

if [ -z "$AWS_SESSION_TOKEN" ]; then
    echo "ERROR: Could not get credentials. Run: aws sso login --profile bedrock-claude"
    exit 1
fi

# Update Modal secret
modal secret create aws-bedrock \
  AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  AWS_REGION="us-west-2" \
  --force

echo ""
echo "✅ Modal credentials refreshed!"
echo "Credentials will expire in ~1 hour (depending on your SSO config)"
