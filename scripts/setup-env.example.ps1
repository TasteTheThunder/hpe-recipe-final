# Copy this file to setup-env.ps1 and fill in your tokens.
# setup-env.ps1 is gitignored — never commit real credentials.

$env:GIT_USERNAME = "NaomiiAP"
$env:GIT_TOKEN    = "your-github-personal-access-token"

$env:JENKINS_USER  = "thatoneuke"
$env:JENKINS_TOKEN = "your-jenkins-api-token"
$env:JENKINS_URL   = "http://localhost:8080"
$env:JENKINS_JOB   = "hpe-recipe-final"
